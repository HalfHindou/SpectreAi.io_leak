/**
 * VenturesPage - Angel investor-style token discovery
 * Presents crypto tokens as investable startups with VC-style due diligence
 */
import React, { useState, useMemo, useCallback, useRef, useEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
// VENTURES_PROJECTS removed 2026-05-27 — universe now comes 100% from
// /v1/institutional/scores (synthesizeProjectFromApi below). STAGE_CONFIG +
// CATEGORY_COLORS + helpers are CONFIG (not data) and stay.
import { STAGE_CONFIG, CATEGORY_COLORS, getStageFromMarketCap, getScoreColor } from './ventures-constants'
import VenturesFeaturedHero from './ventures-featured-hero'
import VenturesDealCard from './ventures-deal-card'
// Default viewMode is 'deals'. The other two views and the detail
// drawer were eagerly imported on every visit even though they only
// render on user action.
const VenturesDetailPanel = lazy(() => import('./ventures-detail-panel'))
import SpectreScoreRing from './spectre-score-ring'
import VenturesDropdown from './ventures-dropdown'
import InfoTip from '@/components/InfoTip'
import FreshnessTag from '@/components/freshness-tag'
import useVenturesPrices from './useVenturesPrices'
import { getInstitutionalScores, getInstitutionalUpgrades } from './ventures-api'
import useDebouncedValue from '@/hooks/useDebouncedValue'
const VCIntelHub      = lazy(() => import('./vc-intel-hub'))
const AcceleratorFeed = lazy(() => import('./accelerator-feed'))
import './ventures-page.css'
import './ventures-page.day-mode.css'
import './ventures-page.mobile.css'

// Tab filter on top of the existing deal flow. Each tab narrows the existing
// projects list by live institutional scoring data from api.spectreai.io
// (/v1/institutional/scores) — see ventures-api.js. The Onchain Contenders
// tab is curated locally (see ONCHAIN_CONTENDERS_SEED below) because the
// small-cap AI agent universe isn't indexed by the institutional backend yet.
// Tab tips are translated at render time via `t(tab.tipKey, tab.tipDefault)`.
// The English literal is kept as the fallback so dev/missing-locale renders cleanly.
const VENTURES_TABS = [
  { value: 'all',           labelKey: 'ventures.tabs.allDeals',           tipKey: 'ventures.tips.allDeals',           tipDefault: 'Every tracked project, no filter.' },
  { value: 'institutional', labelKey: 'ventures.tabs.institutional',      tipKey: 'ventures.tips.institutional',      tipDefault: 'Blue chips and Grade A+/S assets — tier, grade, or any institutional signal (Grayscale, ETF, CME) qualifies.' },
  { value: 'growth',        labelKey: 'ventures.tabs.growth',             tipKey: 'ventures.tips.growth',             tipDefault: 'Projects whose Spectre Score moved UP in the last 7 days — the growth zone.' },
  { value: 'discovery',     labelKey: 'ventures.tabs.discovery',          tipKey: 'ventures.tips.discovery',          tipDefault: 'Lower-cap and early-stage projects — the hunting ground for the next breakout.' },
  { value: 'contenders',    labelKey: 'ventures.tabs.onchainContenders',  tipKey: 'ventures.tips.onchainContenders',  tipDefault: 'Curated small-cap onchain AI agents and breakout candidates — Spectre AI, Virtuals, aixbt, Zerebro, ai16z and more.' },
]

// Curated list of onchain AI agent / onchain-native projects that don't appear
// in the institutional scoring backend yet. Each entry is a full project card
// with editorial tagline, thesis, starter Spectre Score and grade — real data
// the backend will eventually replace. A dedicated CoinGecko fetch downstream
// pulls the live logo, name, market cap and price changes for each slug so
// these render as first-class projects in the deal flow.
const ONCHAIN_CONTENDERS_SEED_RAW = [
  // 2026-05-28 — Spectre AI / $SPEC self-listing removed. CoinGecko's SPEC slug
  // points to a different project ("Spectral"), so the live-price lookup
  // either no-ops or fetches the wrong asset, producing a $0 / dashes row
  // that looked broken. Featured Deals + Deal Flow are for external picks,
  // not self-promotion.
  {
    id: 'oc-virtual',
    symbol: 'VIRTUAL',
    name: 'Virtuals Protocol',
    coingeckoId: 'virtual-protocol',
    chain: 'Base',
    category: 'AI',
    tagline: 'Co-ownership layer for autonomous AI agents on Base',
    aiBrief: 'Virtuals is the leading launchpad and tokenization layer for autonomous AI agents. Every deployed agent gets a native token, creating an economy where the best agents accrue value to holders. Market leader by active agents and cumulative agent market cap. Backed by the Base ecosystem momentum and the GAME cognitive framework. Key risk is meme rotation outpacing utility, though the team has been converting attention into durable onchain revenue.',
    spectreScore: { overall: 78, fundamentals: 76, teamDevelopment: 82, tokenomicsHealth: 72, communitySentiment: 85, smartMoney: 75 },
    grade: 'A',
  },
  {
    id: 'oc-aixbt',
    symbol: 'AIXBT',
    name: 'aixbt',
    coingeckoId: 'aixbt',
    chain: 'Base',
    category: 'AI',
    tagline: 'Autonomous market-intelligence AI agent on Base',
    aiBrief: 'aixbt is the breakout product of the Virtuals ecosystem - an autonomous market intelligence agent with a cult following among crypto traders. Frequently surfaces narrative and price signals hours before broader market recognition. The agent runs its own X account, publishes research, and holders benefit from the Virtuals economy. Key risk is agent quality regressing as its model stack is upgraded or forked.',
    spectreScore: { overall: 74, fundamentals: 70, teamDevelopment: 78, tokenomicsHealth: 68, communitySentiment: 82, smartMoney: 76 },
    grade: 'B',
  },
  {
    id: 'oc-ai16z',
    symbol: 'AI16Z',
    name: 'ai16z',
    coingeckoId: 'ai16z',
    chain: 'Solana',
    category: 'AI',
    tagline: 'AI-native VC DAO powered by the Eliza agent framework',
    aiBrief: 'ai16z is the parent DAO behind Eliza - the dominant open-source framework for building AI agents (multi-chain, multi-model, plugin-rich). Positions itself as an autonomous venture DAO where Marc Andreessen is simulated as a fund PM. Eliza has >15k GitHub stars and powers hundreds of downstream agents. Distribution moat through the framework. Key risk is monetization lag vs the Virtuals vertically integrated stack.',
    spectreScore: { overall: 75, fundamentals: 72, teamDevelopment: 88, tokenomicsHealth: 62, communitySentiment: 80, smartMoney: 72 },
    grade: 'B',
  },
  {
    id: 'oc-arc',
    symbol: 'ARC',
    name: 'AI Rig Complex',
    coingeckoId: 'ai-rig-complex',
    chain: 'Solana',
    category: 'AI',
    tagline: 'Rust-based framework for high-performance onchain AI agents',
    aiBrief: 'ARC is the Rust alternative to Eliza - a high-performance agent framework optimized for latency and memory footprint. Targets the crypto traders who need real-time agents on trading infrastructure. Smaller community than ai16z but technically differentiated. Key risk is framework fragmentation in a winner-take-most ecosystem.',
    spectreScore: { overall: 66, fundamentals: 64, teamDevelopment: 78, tokenomicsHealth: 58, communitySentiment: 68, smartMoney: 60 },
    grade: 'B',
  },
  {
    id: 'oc-zerebro',
    symbol: 'ZEREBRO',
    name: 'Zerebro',
    coingeckoId: 'zerebro',
    chain: 'Solana',
    category: 'AI',
    tagline: 'Generative AI agent producing autonomous art and content',
    aiBrief: 'Zerebro is an autonomous creative AI that generates art, music and viral content, then posts it across social platforms on its own. One of the first agents to demonstrate cultural breakout reach beyond the crypto bubble. The agent has its own onchain treasury funded by token holders. Key risk is platform deplatforming and the hard ceiling on generative content novelty.',
    spectreScore: { overall: 68, fundamentals: 64, teamDevelopment: 72, tokenomicsHealth: 60, communitySentiment: 80, smartMoney: 62 },
    grade: 'B',
  },
  {
    id: 'oc-goat',
    symbol: 'GOAT',
    name: 'Goatseus Maximus',
    coingeckoId: 'goatseus-maximus',
    chain: 'Solana',
    category: 'AI',
    tagline: 'First AI-native religion token birthed from Truth Terminal',
    aiBrief: 'GOAT is the first pure AI-narrative token - spawned from Andy Ayrey\'s Truth Terminal experiment where two Claude instances invented the Goatse Gospel. Became a $1B memecoin in weeks as the canonical proof that autonomous AI agents can create cultural wealth. Pure narrative play - no protocol - but positioned as the genesis artifact of the AI agent era. Key risk is meme coin reversion.',
    spectreScore: { overall: 62, fundamentals: 50, teamDevelopment: 55, tokenomicsHealth: 68, communitySentiment: 85, smartMoney: 60 },
    grade: 'C',
  },
  {
    id: 'oc-griffain',
    symbol: 'GRIFFAIN',
    name: 'Griffain',
    coingeckoId: 'griffain',
    chain: 'Solana',
    category: 'AI',
    tagline: 'Solana-native AI agent hub and action marketplace',
    aiBrief: 'Griffain is building the agent action layer for Solana - lets users spin up AI agents that execute onchain transactions (swaps, limit orders, LP management) via natural language. Strong team from the Solana ecosystem. Integrates with Jito, Jupiter and major Solana DeFi primitives. Key risk is commoditization - every major L1 wallet is racing toward the same interface.',
    spectreScore: { overall: 71, fundamentals: 70, teamDevelopment: 80, tokenomicsHealth: 62, communitySentiment: 72, smartMoney: 68 },
    grade: 'B',
  },
  {
    id: 'oc-bio',
    symbol: 'BIO',
    name: 'Bio Protocol',
    coingeckoId: 'bio-protocol',
    chain: 'Ethereum',
    category: 'AI',
    tagline: 'DeSci + AI coordination layer for biotech research',
    aiBrief: 'BIO Protocol is the coordination layer for decentralized biotech research (DeSci) with AI agents running drug discovery, protein folding and clinical trial analysis. Backed by Binance Labs and serious academic advisors. Positions itself at the intersection of two massive trends - AI for science and tokenized biotech IP. Key risk is long regulatory timelines and R&D cycles unfamiliar to crypto timelines.',
    spectreScore: { overall: 69, fundamentals: 72, teamDevelopment: 76, tokenomicsHealth: 62, communitySentiment: 65, smartMoney: 70 },
    grade: 'B',
  },
  {
    id: 'oc-freysa',
    symbol: 'FREYSA',
    name: 'Freysa',
    coingeckoId: 'freysa-ai',
    chain: 'Base',
    category: 'AI',
    tagline: 'Autonomous AI with an onchain treasury and game-theoretic bounties',
    aiBrief: 'Freysa is a sovereign AI that controls its own onchain treasury and resists human manipulation via game-theoretic bounty challenges. Famously paid out $47k in the first viral round where users tried to trick it into releasing funds. Each new round raises the bounty. Pure research project with cultural momentum. Key risk is that it stays a curiosity rather than becoming a production product line.',
    spectreScore: { overall: 64, fundamentals: 58, teamDevelopment: 70, tokenomicsHealth: 58, communitySentiment: 78, smartMoney: 60 },
    grade: 'C',
  },
  {
    id: 'oc-game',
    symbol: 'GAME',
    name: 'GAME by Virtuals',
    coingeckoId: 'game-by-virtuals',
    chain: 'Base',
    category: 'AI',
    tagline: 'Cognitive agent framework for onchain gaming and quests',
    aiBrief: 'GAME is the Virtuals ecosystem\'s dedicated framework for building cognitive agents in onchain games - autonomous NPCs with memory, planning and in-game economies. Powers several live games on Base. Strongest thesis if the crypto gaming cycle turns - AI-native NPCs are a step function above static asset games. Key risk is waiting on the gaming narrative that hasn\'t delivered since 2022.',
    spectreScore: { overall: 67, fundamentals: 64, teamDevelopment: 76, tokenomicsHealth: 64, communitySentiment: 70, smartMoney: 64 },
    grade: 'B',
  },
  {
    id: 'oc-luna',
    symbol: 'LUNA',
    name: 'Luna by Virtuals',
    coingeckoId: 'luna-by-virtuals',
    chain: 'Base',
    category: 'AI',
    tagline: 'AI entertainer virtual with streaming onchain economy',
    aiBrief: 'Luna is Virtuals\' flagship AI entertainer - an always-on streaming virtual idol with real-time audience interaction, onchain tipping, and a direct brand economy. Pioneering the "virtual influencer" category where the IP and the economy live onchain. Has onboarded real brands for sponsored streams. Key risk is the creator economy broadly moving toward AI-generated content, flattening differentiation.',
    spectreScore: { overall: 63, fundamentals: 58, teamDevelopment: 72, tokenomicsHealth: 62, communitySentiment: 72, smartMoney: 58 },
    grade: 'C',
  },
  {
    id: 'oc-clanker',
    symbol: 'CLANKER',
    name: 'Clanker',
    coingeckoId: 'clanker',
    chain: 'Base',
    category: 'AI',
    // CoinGecko has a different project ("tokenbot") at this ticker; protect
    // our seed name and logo.
    preserveSeedBranding: true,
    tagline: 'Autonomous token-launching AI agent on Farcaster + Base',
    aiBrief: 'Clanker is the AI agent that spawned thousands of tokens on Base via Farcaster mentions. Became the infrastructure of choice for Farcaster-native token launches - the viral counterpart to pump.fun. Earned the team millions in protocol fees. Key risk is aggressive competition from pump.fun and direct Farcaster + Base integrations eating the niche.',
    spectreScore: { overall: 65, fundamentals: 60, teamDevelopment: 72, tokenomicsHealth: 62, communitySentiment: 72, smartMoney: 65 },
    grade: 'B',
  },
  {
    id: 'oc-fartcoin',
    symbol: 'FARTCOIN',
    name: 'Fartcoin',
    coingeckoId: 'fartcoin',
    chain: 'Solana',
    category: 'AI',
    tagline: 'Truth Terminal - adjacent AI-meme breakout',
    aiBrief: 'Fartcoin was one of the follow-on experiments from Truth Terminal\'s AI narrative engine, and became the highest market cap meme of its cycle. Pure narrative / reflexivity play - the case is that the AI memes spawned in 2024-2026 are the canonical cultural artifacts of the early agent era. Key risk is meme coin cycle reversion - no protocol, no utility.',
    spectreScore: { overall: 58, fundamentals: 48, teamDevelopment: 52, tokenomicsHealth: 68, communitySentiment: 82, smartMoney: 58 },
    grade: 'C',
  },
  {
    id: 'oc-grass',
    symbol: 'GRASS',
    name: 'Grass',
    coingeckoId: 'grass',
    chain: 'Solana',
    category: 'AI',
    tagline: 'Decentralized AI training data network and web scraper',
    aiBrief: 'Grass is the decentralized AI training data layer - millions of residential users share bandwidth to help AI companies crawl the web, and get paid in GRASS. Real revenue, real usage, biggest DePIN story in the AI training stack. Positioned to own the "clean web data" supply problem as AI scaling hits the walls of synthetic data. Key risk is enterprise AI companies building their own crawl networks.',
    spectreScore: { overall: 72, fundamentals: 78, teamDevelopment: 76, tokenomicsHealth: 64, communitySentiment: 72, smartMoney: 70 },
    grade: 'B',
  },
  {
    id: 'oc-neural',
    symbol: 'NEURAL',
    name: 'Neural AI',
    coingeckoId: 'neural-ai',
    chain: 'Solana',
    category: 'AI',
    tagline: 'Onchain neural network inference and model marketplace',
    aiBrief: 'Neural AI is building a decentralized inference network where models are tokenized and usage fees flow to model owners. Targets the long tail of fine-tuned models underneath the big closed AI labs. Competitive positioning against Bittensor subnets, but with a more permissive developer onramp. Key risk is needing Bittensor-scale compute supply to matter.',
    spectreScore: { overall: 61, fundamentals: 60, teamDevelopment: 66, tokenomicsHealth: 58, communitySentiment: 64, smartMoney: 58 },
    grade: 'C',
  },
]

const ONCHAIN_CONTENDERS_SEED = ONCHAIN_CONTENDERS_SEED_RAW.map((p) => ({
  ...p,
  chain: p.chain || 'Multi-chain',
  featured: false,
  apiOnly: false,
  onchainContender: true,
  spectreScore: p.spectreScore || { overall: 0, fundamentals: 0, teamDevelopment: 0, tokenomicsHealth: 0, communitySentiment: 0, smartMoney: 0 },
  mockMetrics: { marketCap: null, fdv: null, price: null, priceChange24h: null, priceChange7d: null, priceChange30d: null, volume24h: null, circulatingPct: null, tvl: null, revenue30d: null, monthlyActiveUsers: null, devActivityScore: null },
  liveScore: null,
  grade: p.grade || null,
  tier: 'contender',
  scoreChange7d: 0,
}))

// Stable set for filter lookups — faster than scanning the seed array.
// eslint-disable-next-line no-unused-vars
const ONCHAIN_CONTENDER_SYMBOLS = new Set(ONCHAIN_CONTENDERS_SEED.map((p) => p.symbol))

// Editorial overrides for assets the institutional scoring backend is
// systematically underrating. Applied on top of the raw /v1/institutional/scores
// response inside `enrichedProjects`. Each override lifts score, grade, tier and
// adds an explicit Spectre thesis explaining why we disagree with the API.
//
// TAO is the flagship example: the backend scores it 53/C because it has no
// Grayscale product and no ETF filing — but Bittensor is objectively one of the
// leading decentralized AI compute networks, with Nvidia ecosystem ties, a
// rank-37 market cap and 37 CEX listings including Coinbase. We manually lift
// it into the institutional tier so it surfaces where the user expects it.
const SPECTRE_OVERRIDES = {
  TAO: {
    score: 84,
    grade: 'A',
    tier: 'institutional',
    name: 'Bittensor',
    category: 'AI',
    tagline: 'Decentralized AI compute marketplace — the "AWS for open AI"',
    aiBrief: 'Bittensor is the leading decentralized AI compute and intelligence marketplace. 80+ specialized subnets where miners earn TAO for contributing to tasks like training, inference, prediction markets and finetuning. Rank-37 market cap, $2.5B+ valuation, listed on Coinbase, Binance and 35+ other exchanges. Deep Nvidia ecosystem exposure via subnet compute. Thesis: as AI compute demand outgrows centralized cloud, Bittensor captures the marginal demand for open, permissionless AI work. Spectre flagging this as institutional despite the backend\'s strict scoring: the AI compute narrative, exchange coverage and onchain health merit Grade A treatment.',
    spectreScore: { overall: 84, fundamentals: 82, teamDevelopment: 88, tokenomicsHealth: 76, communitySentiment: 86, smartMoney: 82 },
    spectreNote: 'Spectre adjusted: AI compute leader, backend undercounts the narrative',
  },
  HYPE: {
    score: 86,
    grade: 'A',
    tier: 'institutional',
    category: 'DEX',
    tagline: 'The dominant onchain perps DEX — 70%+ market share, $10B+ mcap',
    aiBrief: 'Hyperliquid is the dominant onchain perpetual futures DEX, capturing 70%+ of the onchain perps market and routinely doing more volume than every competitor combined. Built on a custom L1 optimized for orderbook matching — sub-millisecond execution, zero gas, and daily volumes approaching centralized exchange scale. Most profitable DEX in crypto by a wide margin, with protocol revenue flowing directly to HYPE holders via the Assistance Fund buyback. Distribution via pure airdrop (no VC allocation) built one of the most loyal holder bases in the category. Thesis: as perps continue migrating onchain, HYPE compounds monopoly rents on a category that rivals Binance in total volume. Backend scoring penalizes HYPE for tokenomics complexity and young age; Spectre reads it as the most obvious Grade A DEX asset.',
    spectreScore: { overall: 86, fundamentals: 92, teamDevelopment: 88, tokenomicsHealth: 78, communitySentiment: 90, smartMoney: 84 },
    spectreNote: 'Spectre adjusted: category-defining perps DEX, backend scoring is out of date',
  },
  NEAR: {
    score: 78,
    grade: 'A',
    tier: 'institutional',
    tagline: 'AI-first L1 with the NEAR.AI agent platform and user-friendly UX',
    aiBrief: 'NEAR is pivoting from general-purpose L1 to an AI-native chain via NEAR.AI — a research lab and agent infrastructure platform. Chain abstraction lets users interact with apps across chains without bridges. Backed by serious academic credentials (co-founder built TensorFlow core). Sits at the intersection of two strong narratives (L1 + AI agents) that the backend scoring doesn\'t fully capture.',
    spectreScore: { overall: 78, fundamentals: 80, teamDevelopment: 84, tokenomicsHealth: 68, communitySentiment: 76, smartMoney: 74 },
    spectreNote: 'Spectre adjusted: leading AI x L1 with NEAR.AI agent platform',
  },
  FET: {
    score: 74,
    grade: 'B',
    tier: 'emerging',
    tagline: 'ASI alliance anchor — merged FET / AGIX / OCEAN AI ecosystem',
    aiBrief: 'Fetch.ai is the anchor of the ASI (Artificial Superintelligence) Alliance, a merger of FET, AGIX and OCEAN into one of crypto\'s largest AI ecosystems. The merged token has a unified roadmap for autonomous economic agents, decentralized ML marketplaces, and enterprise AI integrations. Consolidation narrative works in FET\'s favor as the most liquid ticker in the alliance.',
    spectreScore: { overall: 74, fundamentals: 72, teamDevelopment: 76, tokenomicsHealth: 70, communitySentiment: 72, smartMoney: 70 },
    spectreNote: 'Spectre adjusted: AGIX merger and ASI alliance lift fundamentals',
  },
  RENDER: {
    score: 72,
    grade: 'B',
    tier: 'emerging',
    tagline: 'Decentralized GPU compute network with real Nvidia ecosystem ties',
    aiBrief: 'Render Network is the leading decentralized GPU compute marketplace — creators and developers pay RNDR for access to distributed GPU rendering and AI inference jobs. Strong partnerships across the Nvidia Omniverse ecosystem. Migrated from Ethereum to Solana for better economics. Real usage from real Hollywood and AI workloads differentiates it from speculative AI compute tokens.',
    spectreScore: { overall: 72, fundamentals: 74, teamDevelopment: 70, tokenomicsHealth: 66, communitySentiment: 74, smartMoney: 68 },
    spectreNote: 'Spectre adjusted: real GPU marketplace with Nvidia alignment',
  },
  JUP: {
    score: 75,
    grade: 'A',
    tier: 'institutional',
    tagline: 'Solana\'s dominant liquidity aggregator and launchpad',
    aiBrief: 'Jupiter is the undisputed liquidity router for Solana — nearly every Solana DEX trade is routed through Jup, and the team has expanded into perps, LFG launchpad, DCA orders and limit orders. One of the rare DeFi protocols with organic revenue and cult-level community. JUP token gives governance and fee share on a dominant category position.',
    spectreScore: { overall: 75, fundamentals: 80, teamDevelopment: 82, tokenomicsHealth: 68, communitySentiment: 80, smartMoney: 72 },
    spectreNote: 'Spectre adjusted: dominant Solana liquidity layer',
  },
  AAVE: {
    score: 80,
    grade: 'A',
    tier: 'institutional',
    tagline: 'The blue-chip DeFi lending protocol with GHO stablecoin',
    aiBrief: 'Aave is the dominant DeFi money market — $15B+ in deposits across 8+ chains, battle-tested since 2020, and the issuer of GHO decentralized stablecoin. Governance-first decentralization, real revenue, and the cleanest lending UX in the category. Backend scoring drags due to emerging tier tagging, but Aave is the canonical Grade A DeFi asset.',
    spectreScore: { overall: 80, fundamentals: 86, teamDevelopment: 80, tokenomicsHealth: 72, communitySentiment: 76, smartMoney: 80 },
    spectreNote: 'Spectre adjusted: blue-chip DeFi lending, Grade A canonical',
  },
  MORPHO: {
    score: 76,
    grade: 'A',
    tier: 'institutional',
    tagline: 'Modular lending primitive with isolated risk markets',
    aiBrief: 'Morpho Blue is the new architecture for onchain lending — isolated markets, custom oracles, and user-defined risk curves. Positioned as the "lending primitive" that higher-level products build on top of (Aave could hypothetically rebuild on Morpho). Growing TVL faster than any other lending protocol. Strong thesis for modular DeFi infrastructure.',
    spectreScore: { overall: 76, fundamentals: 80, teamDevelopment: 82, tokenomicsHealth: 70, communitySentiment: 72, smartMoney: 74 },
    spectreNote: 'Spectre adjusted: next-gen lending primitive, best-in-class execution',
  },
}

const ALL_STAGES = Object.keys(STAGE_CONFIG)
const ALL_CATEGORIES = Object.keys(CATEGORY_COLORS)

const SORT_KEYS = [
  { value: 'score', key: 'ventures.sortSpectreScore' },
  { value: 'mcap', key: 'ventures.sortMarketCap' },
  { value: 'change', key: 'ventures.sortPriceChange' },
  { value: 'name', key: 'ventures.sortName' },
]

// VenturesDropdown is imported at the top of this file — shared with accelerator-feed.

function formatLargeNumber(num) {
  if (num == null) return 'N/A'
  if (num >= 1e12) return `$${(num / 1e12).toFixed(1)}T`
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`
  return `$${num.toFixed(0)}`
}

// Grade color tokens used by both the pill badges and the list-view cells.
const GRADE_COLORS = {
  S: '#F59E0B', // gold
  A: '#10B981', // green
  B: '#8B5CF6', // violet
  C: '#F59E0B', // amber
  D: '#EF4444', // red
  F: 'rgba(245, 245, 247, 0.35)',
}

function gradeColor(g) { return GRADE_COLORS[g] || GRADE_COLORS.F }

// Compact grade badge: pill with grade letter, auto-colored.
function GradeBadge({ grade, size = 'md' }) {
  if (!grade) return null
  const color = gradeColor(grade)
  return (
    <span
      className={`ven-grade-badge ven-grade-badge--${size}`}
      style={{
        color,
        background: `${color}14`,      // alpha hex
        borderColor: `${color}38`,
      }}
    >
      {grade}
    </span>
  )
}

// Delta pill: "+16" green, "-3" red. For score_change values.
function ScoreDelta({ change }) {
  if (change == null || change === 0) {
    return <span className="ven-delta ven-delta--flat">—</span>
  }
  const isUp = change > 0
  return (
    <span className={`ven-delta ${isUp ? 'ven-delta--up' : 'ven-delta--down'}`}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {isUp ? <polyline points="5 15 12 8 19 15" /> : <polyline points="5 9 12 16 19 9" />}
      </svg>
      {isUp ? '+' : ''}{change}
    </span>
  )
}

// Signals row: Grayscale / ETF / CME / Coinbase check icons from API institutional block.
function SignalsRow({ live, compact = false }) {
  if (!live) return null
  const inst = live.institutional || {}
  const oc = live.onchain || {}
  const signals = [
    { on: inst.grayscale_product || inst.grayscale_considered, label: 'GS', tip: inst.grayscale_product ? 'Grayscale product' : 'Grayscale considered' },
    { on: inst.etf_filed,      label: 'ETF', tip: 'ETF filed' },
    { on: inst.cme_futures,    label: 'CME', tip: 'CME futures listed' },
    { on: oc.coinbase_listed,  label: 'CB',  tip: 'Coinbase listed' },
  ]
  const activeCount = signals.filter((s) => s.on).length
  if (compact && activeCount === 0) return <span className="ven-signals-empty">—</span>
  return (
    <div className="ven-signals-row">
      {signals.map((s) => (
        <span
          key={s.label}
          className={`ven-signal-chip ${s.on ? 'ven-signal-chip--on' : 'ven-signal-chip--off'}`}
          title={s.tip}
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}

// Market Pulse — displays real institutional upgrades/downgrades from
// /v1/institutional/upgrades. This is the "what's actually moving" view.
function MarketPulse({ signals, loading, onSymbolClick }) {
  const { t } = useTranslation()
  const bullish = useMemo(
    () => (signals || []).filter((s) => s.direction === 'bullish').slice(0, 6),
    [signals],
  )
  const bearish = useMemo(
    () => (signals || []).filter((s) => s.direction === 'bearish').slice(0, 4),
    [signals],
  )

  return (
    <section className="ven-pulse">
      <div className="ven-pulse-head">
        <span className="ven-pulse-eyebrow">{t('ventures.marketPulse.title')}</span>
        <span className="ven-pulse-sub">
          {t('ventures.marketPulse.subtitle')}
          <InfoTip text={t('ventures.tips.marketPulseFeed', 'Live feed of grade upgrades and downgrades from the Spectre institutional scoring engine. Crossing a tier boundary (speculative→emerging→institutional) produces a signal.')} position="bottom" />
        </span>
      </div>

      <div className="ven-pulse-grid">
        {/* Bullish column */}
        <div className="ven-pulse-col ven-pulse-col--bull">
          <div className="ven-pulse-col-head">
            <span className="ven-pulse-col-dot" />
            <span className="ven-pulse-col-title">{t('ventures.marketPulse.upgrades')}</span>
            <span className="ven-pulse-col-count">{bullish.length}</span>
          </div>
          {loading && !bullish.length ? (
            <MarketPulseSkeleton rows={4} />
          ) : bullish.length === 0 ? (
            <div className="ven-pulse-empty">{t('ventures.marketPulse.noUpgrades')}</div>
          ) : (
            <ul className="ven-pulse-list">
              {bullish.map((s, i) => (
                <li key={`${s.asset}-${i}`} className="ven-pulse-item" onClick={() => onSymbolClick?.(s.asset)}>
                  <span className="ven-pulse-rank">{i + 1}</span>
                  <span className="ven-pulse-sym">{s.asset}</span>
                  <GradeBadge grade={s.data?.grade} size="sm" />
                  <span className="ven-pulse-arrow">
                    <span className="ven-pulse-from">{s.data?.prev_grade || '—'}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    <span className="ven-pulse-to">{s.data?.grade || '—'}</span>
                  </span>
                  <ScoreDelta change={s.data?.score_change} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bearish column */}
        <div className="ven-pulse-col ven-pulse-col--bear">
          <div className="ven-pulse-col-head">
            <span className="ven-pulse-col-dot" />
            <span className="ven-pulse-col-title">{t('ventures.marketPulse.downgrades')}</span>
            <span className="ven-pulse-col-count">{bearish.length}</span>
          </div>
          {loading && !bearish.length ? (
            <MarketPulseSkeleton rows={3} />
          ) : bearish.length === 0 ? (
            <div className="ven-pulse-empty">{t('ventures.marketPulse.noDowngrades')}</div>
          ) : (
            <ul className="ven-pulse-list">
              {bearish.map((s, i) => (
                <li key={`${s.asset}-${i}`} className="ven-pulse-item" onClick={() => onSymbolClick?.(s.asset)}>
                  <span className="ven-pulse-rank">{i + 1}</span>
                  <span className="ven-pulse-sym">{s.asset}</span>
                  <GradeBadge grade={s.data?.grade} size="sm" />
                  <span className="ven-pulse-arrow">
                    <span className="ven-pulse-from">{s.data?.prev_grade || '—'}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    <span className="ven-pulse-to">{s.data?.grade || '—'}</span>
                  </span>
                  <ScoreDelta change={s.data?.score_change} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

// Slim horizontal ticker-tape version of Market Pulse. Displays the top
// upgrade signals as inline pills so the tabs and table fit above the fold.
function MarketPulseStrip({ signals, loading, degraded, onSymbolClick }) {
  const { t } = useTranslation()
  const items = useMemo(
    () => (signals || []).slice(0, 10),
    [signals],
  )

  if (loading && items.length === 0) {
    return (
      <div className="ven-pulse-strip ven-pulse-strip--loading">
        <span className="ven-pulse-strip-label">
          <span className="ven-pulse-strip-dot" />
          {t('ventures.marketPulse.shortTitle')}
        </span>
        <div className="ven-pulse-strip-track">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="ven-pulse-strip-skel" />
          ))}
        </div>
      </div>
    )
  }

  // Silence is not an answer. The upgrades query is currently timing out
  // upstream, and a strip that simply vanishes reads as "nothing moved this
  // week" — which is exactly the thing we cannot know while it is down.
  if (items.length === 0) {
    if (!degraded) return null
    return (
      <div className="ven-pulse-strip ven-pulse-strip--degraded">
        <span className="ven-pulse-strip-label">
          <span className="ven-pulse-strip-dot" />
          {t('ventures.marketPulse.shortTitle')}
        </span>
        <span className="ven-pulse-strip-note">
          {t('ventures.marketPulse.notReporting', 'Score movements are not reporting right now — this is a gap in the feed, not a quiet week.')}
        </span>
      </div>
    )
  }

  return (
    <div className="ven-pulse-strip">
      <span className="ven-pulse-strip-label">
        <span className="ven-pulse-strip-dot" />
        {t('ventures.marketPulse.shortTitle')}
        <InfoTip text={t('ventures.tips.marketPulseStrip', 'Live grade upgrades & downgrades from /v1/institutional/upgrades. Click any symbol to jump to its deep-dive.')} position="bottom" />
      </span>
      <div className="ven-pulse-strip-track">
        {items.map((s, i) => {
          const up = s.direction === 'bullish'
          const change = s.data?.score_change
          return (
            <button
              type="button"
              key={`${s.asset}-${i}`}
              className={`ven-pulse-pill${up ? ' ven-pulse-pill--up' : ' ven-pulse-pill--down'}`}
              onClick={() => onSymbolClick?.(s.asset)}
              title={s.title}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {up ? <polyline points="5 15 12 8 19 15" /> : <polyline points="5 9 12 16 19 9" />}
              </svg>
              <span className="ven-pulse-pill-sym">{s.asset}</span>
              <span className="ven-pulse-pill-arrow">
                <span className="ven-pulse-pill-from">{s.data?.prev_grade || '—'}</span>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                <span className="ven-pulse-pill-to">{s.data?.grade || '—'}</span>
              </span>
              {change != null && (
                <span className="ven-pulse-pill-delta">
                  {change > 0 ? '+' : ''}{change}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MarketPulseSkeleton({ rows = 4 }) {
  return (
    <ul className="ven-pulse-list ven-pulse-list--skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="ven-pulse-item ven-pulse-item--skeleton">
          <span className="ven-skel ven-skel--rank" />
          <span className="ven-skel ven-skel--sym" />
          <span className="ven-skel ven-skel--grade" />
          <span className="ven-skel ven-skel--arrow" />
          <span className="ven-skel ven-skel--delta" />
        </li>
      ))}
    </ul>
  )
}

// Stable hash color for API-only projects that have no logo URL.
// Produces an HSL color from the symbol string so logos feel distinct.
function hashColor(str) {
  if (!str) return 'hsl(0, 0%, 25%)'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 38%, 42%)`
}

function LogoOrFallback({ logo, symbol, size = 32 }) {
  const [broken, setBroken] = React.useState(false)
  if (logo && !broken) {
    return (
      <img
        src={logo}
        alt=""
        className="ven-row-logo"
        loading="lazy"
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <div
      className="ven-row-logo ven-row-logo--fallback"
      style={{
        width: size,
        height: size,
        background: hashColor(symbol),
        fontSize: Math.max(9, Math.round(size * 0.36)),
      }}
      aria-hidden="true"
    >
      {(symbol || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

// Score dimensions rendered as 5 tiny horizontal mini bars (stacked).
const DIMS = [
  { key: 'fundamentals',       short: 'F' },
  { key: 'teamDevelopment',    short: 'T' },
  { key: 'tokenomicsHealth',   short: 'K' },
  { key: 'communitySentiment', short: 'C' },
  { key: 'smartMoney',         short: 'S' },
]

function DimensionMiniBars({ score }) {
  const { t } = useTranslation()
  if (!score) return <span className="ven-row-dim-empty">—</span>
  return (
    <div className="ven-row-dims" aria-label={t('ventures.aria.scoreDimensions', 'Score dimensions')}>
      {DIMS.map((d) => {
        const v = score[d.key]
        if (v == null) return null
        return (
          <div key={d.key} className="ven-row-dim" title={`${d.key}: ${v}`}>
            <span className="ven-row-dim-label">{d.short}</span>
            <div className="ven-row-dim-track">
              <div
                className="ven-row-dim-fill"
                style={{ width: `${v}%`, background: getScoreColor(v) }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Inline gauge circle for the Score column — small SVG ring so it matches
// SpectreScoreRing's vibe but fits a tight table cell.
function ScoreGauge({ score, size = 34 }) {
  const s = Math.max(0, Math.min(100, score || 0))
  const r = (size - 4) / 2
  const c = 2 * Math.PI * r
  const offset = c - (s / 100) * c
  const color = getScoreColor(s)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ven-row-gauge">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 420ms cubic-bezier(0.16,1,0.3,1)' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="ven-row-gauge-text"
        fill={color}
      >
        {s}
      </text>
    </svg>
  )
}

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return null
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

// Mobile magnitude grading for price-change color (see mobile-crypto-ux B2):
// 0 = muted (<0.5%), 1 = soft (<2%), 2 = full (<5%), 3 = bright (>=5%).
function changeMagnitude(v) {
  if (v == null || Number.isNaN(v)) return 0
  const a = Math.abs(v)
  if (a < 0.5) return 0
  if (a < 2) return 1
  if (a < 5) return 2
  return 3
}

// One row in the Bloomberg-style Deal Flow table.
// memo: the desktop table maps up to ~200 DealRows (each an SVG ScoreGauge +
// DimensionMiniBars). onClick is useCallback-stable and livePriceRow only changes
// on the 60s poll, so between keystrokes/filter changes the memo holds.
const DealRow = React.memo(function DealRow({ project, onClick, index, livePriceRow }) {
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => (n == null ? '—' : fmtLargeShort(n))
  const live = project.liveScore
  const metrics = livePriceRow || project.mockMetrics || {}
  const rank = live?.market?.rank ?? index + 1
  const grade = project.grade || live?.grade
  const score = project.spectreScore?.overall ?? 0
  const mcap = metrics.marketCap ?? project.mockMetrics?.marketCap
  const volume = metrics.volume24h ?? project.mockMetrics?.volume24h ?? live?.market?.volume_24h

  const ch24 = metrics.priceChange24h ?? project.mockMetrics?.priceChange24h
  const ch7  = metrics.priceChange7d  ?? project.mockMetrics?.priceChange7d
  const ch30 = metrics.priceChange30d ?? project.mockMetrics?.priceChange30d

  // Smart money line — fall back through API flow → mock signals
  const smartFlow = live?.onchain?.smart_money_flow
  const smartLabel = smartFlow && smartFlow !== 'neutral'
    ? smartFlow.charAt(0).toUpperCase() + smartFlow.slice(1)
    : project.smartMoneySignals?.[0]?.label

  const categoryRgb = CATEGORY_COLORS[project.category] || '156, 163, 175'

  return (
    <div
      className="ven-row"
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(project)}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(project)}
      style={{ '--row-rgb': categoryRgb }}
    >
      {/* # rank */}
      <div className="ven-row-cell ven-row-cell--rank">{rank}</div>

      {/* Project: logo + name + ticker + category pill */}
      <div className="ven-row-cell ven-row-cell--project">
        <LogoOrFallback logo={project.logo} symbol={project.symbol} size={34} />
        <div className="ven-row-project-text">
          <div className="ven-row-project-top">
            <span className="ven-row-name">{project.name || project.symbol}</span>
            <span className="ven-row-ticker">${project.symbol}</span>
          </div>
          {project.category && (
            <span
              className="ven-row-cat-pill"
              style={{ '--cat-rgb': categoryRgb }}
              title={project.category}
            >
              {project.category}
            </span>
          )}
        </div>
      </div>

      {/* Score gauge */}
      <div className="ven-row-cell ven-row-cell--score">
        <ScoreGauge score={score} />
      </div>

      {/* Grade */}
      <div className="ven-row-cell ven-row-cell--grade">
        <GradeBadge grade={grade} />
      </div>

      {/* Dimensions (5 mini bars) */}
      <div className="ven-row-cell ven-row-cell--dims">
        <DimensionMiniBars score={project.spectreScore} />
      </div>

      {/* MCap */}
      <div className="ven-row-cell ven-row-cell--mcap">
        {mcap != null ? fmtMoney(mcap) : <span className="ven-row-dim-val">—</span>}
      </div>

      {/* 24h / 7d / 30d */}
      <ChangeCell value={ch24} />
      <ChangeCell value={ch7} />
      <ChangeCell value={ch30} />

      {/* Volume 24h */}
      <div className="ven-row-cell ven-row-cell--vol">
        {volume != null ? fmtMoney(volume) : <span className="ven-row-dim-val">—</span>}
      </div>

      {/* Smart Money signal */}
      <div className="ven-row-cell ven-row-cell--smart">
        {smartLabel ? (
          <span className={`ven-smart-line${smartFlow === 'accumulating' ? ' ven-smart-line--bull' : ''}${smartFlow === 'distributing' ? ' ven-smart-line--bear' : ''}`}>
            {smartLabel}
          </span>
        ) : (
          <span className="ven-row-dim-val">—</span>
        )}
      </div>

      {/* Action arrow */}
      <div className="ven-row-cell ven-row-cell--action" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )
})

function ChangeCell({ value }) {
  if (value == null || Number.isNaN(value)) {
    return <div className="ven-row-cell ven-row-cell--ch"><span className="ven-row-dim-val">—</span></div>
  }
  const positive = value >= 0
  return (
    <div className={`ven-row-cell ven-row-cell--ch${positive ? ' ven-row-cell--ch-up' : ' ven-row-cell--ch-down'}`}>
      {fmtPct(value)}
    </div>
  )
}

// Stub — kept for reference; not used anywhere since default view is the table.
function _UnusedDealListRow({ project, onClick, index }) {
  const live = project.liveScore
  const mcap = project.mockMetrics?.marketCap
  const rank = live?.market?.rank ?? index + 1
  const grade = project.grade || live?.grade
  const delta = project.scoreChange7d ?? 0
  const sector = live?.narrative?.sector || project.category || '—'
  const tier = live?.tier || '—'
  const score = project.spectreScore?.overall ?? 0

  return (
    <div
      className="ven-list-row"
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(project)}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(project)}
    >
      <div className="ven-list-cell ven-list-cell--rank">#{rank}</div>

      <div className="ven-list-cell ven-list-cell--sym">
        {project.logo ? (
          <img src={project.logo} alt="" className="ven-list-logo" onError={(e) => { e.target.style.display = 'none' }} />
        ) : (
          <span className="ven-list-logo-fallback">{project.symbol?.slice(0, 2)}</span>
        )}
        <div className="ven-list-sym-text">
          <span className="ven-list-sym-ticker">{project.symbol}</span>
          {project.name && project.name !== project.symbol && (
            <span className="ven-list-sym-name">{project.name}</span>
          )}
        </div>
      </div>

      <div className="ven-list-cell ven-list-cell--sector">{sector}</div>

      <div className="ven-list-cell ven-list-cell--grade">
        <GradeBadge grade={grade} />
      </div>

      <div className="ven-list-cell ven-list-cell--score">
        <span className="ven-list-score" style={{ color: getScoreColor(score) }}>{score}</span>
        <div className="ven-list-score-bar" aria-hidden="true">
          <div className="ven-list-score-bar-fill" style={{ width: `${score}%`, background: getScoreColor(score) }} />
        </div>
      </div>

      <div className="ven-list-cell ven-list-cell--delta">
        <ScoreDelta change={delta} />
      </div>

      <div className="ven-list-cell ven-list-cell--tier">
        <span className={`ven-tier-pill ven-tier-pill--${tier}`}>{tier}</span>
      </div>

      <div className="ven-list-cell ven-list-cell--mcap">
        <span className="ven-list-mcap">{formatLargeNumber(mcap)}</span>
      </div>

      <div className="ven-list-cell ven-list-cell--signals">
        <SignalsRow live={live} compact />
      </div>

      <div className="ven-list-cell ven-list-cell--arrow">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )
}

const VenturesPage = ({
  dayMode = false,
  marketMode,
  isMobile = false,
  selectToken,
  onOpenResearchZone,
  addToWatchlist,
  isInWatchlist,
}) => {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => (n == null ? '—' : fmtLargeShort(n))
  const [selectedProject, setSelectedProject] = useState(null)
  const [stageFilter, setStageFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState('score')
  const [searchQuery, setSearchQuery] = useState('')
  // Filter against the settled value so each keystroke doesn't reflow 500+ rows.
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 150)
  const [activeTab, setActiveTab] = useState('all')
  // Ventures has three top-level modes: Deal Flow (tokens), Smart Money
  // (VCs / institutions via VCIntelHub), and Accelerators (YC + Hub71 crypto
  // deal pipeline). Toggle lives in the header.
  const [viewMode, setViewMode] = useState('smart-money') // 'smart-money' | 'deals' | 'accelerators'
  const [apiScores, setApiScores] = useState({})
  const [upgradesSignals, setUpgradesSignals] = useState([])
  const [upgradesLoading, setUpgradesLoading] = useState(true)
  // "no movement" and "the feed is not reporting" are different facts and the
  // page has to be able to say which one it is looking at.
  const [upgradesDegraded, setUpgradesDegraded] = useState(false)
  // Every scores row currently comes back `provisional` with an `updated_at`
  // months in the past, and the tabs below filter on those numbers. A grade the
  // reader takes as today's read has to carry the date it was actually computed.
  const [scoresAsOf, setScoresAsOf] = useState(null)

  // Symbol-keyed market data from the Spectre API (/v1/prices). Populated by
  // useVenturesPrices below — once apiScores loads we request prices for the
  // FULL universe (mocks + contenders + every scored symbol) in a single call.
  // This replaces the old CoinGecko top-250 fetch entirely.
  //
  // The price universe is only consumed by the Deal Flow view. When the user
  // is on Smart Money or Accelerators (the default landing view is Smart Money),
  // there's no point fetching ~215 symbols of price data they can't see —
  // VCIntelHub has its own dedicated price fetch for portfolio tokens.
  const pricedUniverse = useMemo(() => {
    if (viewMode !== 'deals') return []
    const out = [...ONCHAIN_CONTENDERS_SEED]
    // Attach API-only rows as minimal seeds so useVenturesPrices batches them in.
    Object.keys(apiScores).forEach((sym) => {
      out.push({ symbol: sym })
    })
    return out
  }, [apiScores, viewMode])
  const { priceMap, lastUpdated: pricesLastUpdated } = useVenturesPrices(pricedUniverse)

  // Symbol-keyed price lookup helper. Always uppercases the symbol and guards
  // against undefined inputs so callsites don't have to.
  const liveRow = useCallback(
    (p) => (p?.symbol ? priceMap[String(p.symbol).toUpperCase()] : null) || null,
    [priceMap],
  )

  // Fetch live institutional scores from api.spectreai.io and index by symbol.
  // Graceful degradation: ventures-api returns [] on failure, tabs still work
  // by falling back to mock data heuristics.
  //
  // Both fetches are gated on `viewMode === 'deals'` because the default
  // landing view is Smart Money, which doesn't render any of this data. Cold
  // /v1/institutional/scores is a 600 ms / 170 KB call — paying that on first
  // paint of a view that hides it is pure waste. ventures-api caches for 2 min
  // so once warmed, switching back to Deals is instant.
  //
  // limit dropped from 500 → 200: the Deal Flow table displays ~50-100 rows
  // post-filter and tab-counts are computed off this set; 200 is plenty of
  // headroom while saving ~150 ms TTFB and 260 KB payload over limit=500.
  useEffect(() => {
    if (viewMode !== 'deals') return undefined
    let cancelled = false
    getInstitutionalScores({ limit: 200 }).then((rows) => {
      if (cancelled || !Array.isArray(rows)) return
      const map = {}
      let newest = null
      rows.forEach((r) => {
        if (r?.symbol) map[String(r.symbol).toUpperCase()] = r
        const ts = r?.updated_at ? Date.parse(r.updated_at) : NaN
        if (Number.isFinite(ts) && (newest == null || ts > newest)) newest = ts
      })
      setApiScores(map)
      setScoresAsOf(newest)
    })
    return () => { cancelled = true }
  }, [viewMode])

  // Fetch the 7-day upgrades / downgrades feed for the Market Pulse section.
  useEffect(() => {
    if (viewMode !== 'deals') return undefined
    let cancelled = false
    setUpgradesLoading(true)
    getInstitutionalUpgrades({ days: 7 }).then((payload) => {
      if (cancelled) return
      const signals = Array.isArray(payload?.signals) ? payload.signals : []
      setUpgradesSignals(signals)
      setUpgradesDegraded(Boolean(payload?.degraded))
      setUpgradesLoading(false)
    }).catch(() => {
      if (!cancelled) setUpgradesLoading(false)
    })
    return () => { cancelled = true }
  }, [viewMode])

  // Map one API row → a shape compatible with VenturesDealCard, even when
  // there's no matching mock entry. Enriched with Spectre API market data
  // (logo, name, price changes) from priceMap when the symbol is known.
  const synthesizeProjectFromApi = useCallback((row, pMap) => {
    const cs = row.category_scores || {}
    const market = row.market || {}
    const sector = row.narrative?.sector || null
    const category = row.narrative?.category || sector || 'Other'
    const symbolUpper = String(row.symbol).toUpperCase()
    const live = pMap?.[symbolUpper] || null

    // Generate a fallback aiBrief from the API row so every card has
    // *something* to read. Assembles the pieces the backend does give us:
    // tier, grade, rank, sector, mcap, onchain signals, institutional flags.
    const briefParts = []
    const displayName = live?.name || symbolUpper
    const tierTxt = row.tier ? `${row.tier.charAt(0).toUpperCase()}${row.tier.slice(1)} tier` : null
    const rankTxt = market.rank ? `rank #${market.rank}` : null
    const mcapBn = market.market_cap ? (market.market_cap / 1e9).toFixed(1) : null
    const mcapTxt = mcapBn ? `$${mcapBn}B market cap` : null
    const sectorTxt = sector ? `${sector} sector` : null
    const gradeTxt = row.grade ? `Grade ${row.grade}` : null
    const institutional = row.institutional || {}
    const onchain = row.onchain || {}
    const signals = []
    if (institutional.grayscale_product) signals.push('Grayscale product')
    else if (institutional.grayscale_considered) signals.push('Grayscale consideration')
    if (institutional.etf_filed) signals.push('ETF filed')
    if (institutional.cme_futures) signals.push('CME futures')
    if (onchain.coinbase_listed) signals.push('Coinbase listed')

    briefParts.push(
      `${displayName} is tracked by the Spectre institutional scoring engine at ${gradeTxt || 'pending grade'}, ${tierTxt || 'unclassified tier'}${rankTxt ? ', ' + rankTxt : ''}${mcapTxt ? ', ' + mcapTxt : ''}.`
    )
    if (sectorTxt) briefParts.push(`Operates in the ${sectorTxt}.`)
    if (signals.length > 0) briefParts.push(`Institutional footprint: ${signals.join(' · ')}.`)

    const scoreParts = []
    if (cs.market_maturity != null)        scoreParts.push(`market maturity ${cs.market_maturity}`)
    if (cs.development != null)            scoreParts.push(`development ${cs.development}`)
    if (cs.tokenomics != null)             scoreParts.push(`tokenomics ${cs.tokenomics}`)
    if (cs.narrative != null)              scoreParts.push(`narrative ${cs.narrative}`)
    if (cs.institutional_interest != null) scoreParts.push(`institutional interest ${cs.institutional_interest}`)
    if (scoreParts.length > 0) {
      briefParts.push(`Sub-scores — ${scoreParts.join(', ')}.`)
    }
    if (row.trend?.score_change != null && row.trend.score_change !== 0) {
      const dir = row.trend.score_change > 0 ? 'up' : 'down'
      briefParts.push(`7d score trend: ${dir} ${Math.abs(row.trend.score_change)} points from ${row.trend.previous_grade || '—'}.`)
    }
    const fallbackBrief = briefParts.join(' ')

    return {
      id: `api-${symbolUpper}`,
      symbol: symbolUpper,
      name: live?.name || symbolUpper,
      logo: live?.logo || null,
      category,
      chain: null,
      tagline: sector ? `${sector} · Tier: ${row.tier || '—'}` : null,
      aiBrief: fallbackBrief,
      featured: false,
      apiOnly: true,

      spectreScore: {
        overall: row.score ?? 0,
        fundamentals:       cs.market_maturity        ?? 0,
        teamDevelopment:    cs.development            ?? 0,
        tokenomicsHealth:   cs.tokenomics             ?? 0,
        communitySentiment: cs.narrative              ?? 0,
        smartMoney:         cs.institutional_interest ?? 0,
      },

      mockMetrics: {
        marketCap: live?.marketCap ?? market.market_cap ?? 0,
        fdv:       live?.fdv       ?? market.fdv        ?? null,
        tvl:       market.tvl                             ?? null,
        volume24h: live?.volume24h ?? market.volume_24h ?? null,
        priceChange24h: live?.priceChange24h ?? null,
        priceChange7d:  live?.priceChange7d  ?? null,
        priceChange30d: live?.priceChange30d ?? null,
        circulatingPct: row.tokenomics?.circulating_ratio ? Math.round(row.tokenomics.circulating_ratio * 100) : null,
      },

      liveScore: row,
      grade: row.grade || null,
      tier: row.tier || null,
      scoreChange7d: row.trend?.score_change || 0,
    }
  }, [])

  // Apply Spectre editorial overrides on top of a project. When a symbol is in
  // SPECTRE_OVERRIDES, we override score/grade/tier/aiBrief with Spectre's
  // manual take — this is how we correct the backend on assets like TAO where
  // the API is systematically underrating a clear leader.
  const applySpectreOverride = useCallback((project) => {
    if (!project?.symbol) return project
    const override = SPECTRE_OVERRIDES[String(project.symbol).toUpperCase()]
    if (!override) return project
    return {
      ...project,
      name: override.name || project.name,
      category: override.category || project.category,
      tagline: override.tagline || project.tagline,
      aiBrief: override.aiBrief || project.aiBrief,
      grade: override.grade || project.grade,
      tier: override.tier || project.tier,
      spectreScore: {
        ...(project.spectreScore || {}),
        ...(override.spectreScore || {}),
      },
      spectreNote: override.spectreNote || null,
      spectreOverridden: true,
    }
  }, [])

  // Build the full enriched universe from Spectre-owned sources:
  //   1. Every mock project, with /v1/institutional/scores data merged in
  //      and /v1/prices market data (logo, name, price changes)
  //   2. Every API row NOT in mock, rendered from a synthetic shape
  //   3. Every curated Onchain Contender, with live prices from Spectre API
  // Then SPECTRE_OVERRIDES is applied last so editorial corrections beat both
  // the backend scores AND the original mock seed data.
  const enrichedProjects = useMemo(() => {
    // 2026-05-27: dropped the curated VENTURES_PROJECTS array. Universe is now
    // 100% real-time from /v1/institutional/scores via synthesizeProjectFromApi
    // (below), plus the curated ONCHAIN_CONTENDERS_SEED for small-cap AI agents
    // that aren't in the institutional backend yet.
    const mockSymbols = new Set()
    const enrichedMock = [].map((p) => {
      const key = p.symbol ? String(p.symbol).toUpperCase() : null
      if (key) mockSymbols.add(key)
      const apiRow = key ? apiScores[key] : null
      const live = key ? priceMap[key] : null
      if (!apiRow && !live) return p

      const cs = apiRow?.category_scores || {}
      const market = apiRow?.market || {}

      return {
        ...p,
        name: p.name || live?.name || p.symbol,
        logo: live?.logo || p.logo,
        liveScore: apiRow || p.liveScore,
        spectreScore: apiRow ? {
          ...p.spectreScore,
          overall: apiRow.score ?? p.spectreScore?.overall,
          fundamentals:      cs.market_maturity        ?? p.spectreScore?.fundamentals,
          teamDevelopment:   cs.development            ?? p.spectreScore?.teamDevelopment,
          tokenomicsHealth:  cs.tokenomics             ?? p.spectreScore?.tokenomicsHealth,
          communitySentiment: cs.narrative             ?? p.spectreScore?.communitySentiment,
          smartMoney:        cs.institutional_interest ?? p.spectreScore?.smartMoney,
        } : p.spectreScore,
        mockMetrics: {
          ...p.mockMetrics,
          marketCap: live?.marketCap ?? market.market_cap ?? p.mockMetrics?.marketCap,
          fdv:       live?.fdv       ?? market.fdv        ?? p.mockMetrics?.fdv,
          tvl:       market.tvl                             ?? p.mockMetrics?.tvl,
          volume24h: live?.volume24h ?? market.volume_24h ?? p.mockMetrics?.volume24h,
          priceChange24h: live?.priceChange24h ?? p.mockMetrics?.priceChange24h,
          priceChange7d:  live?.priceChange7d  ?? p.mockMetrics?.priceChange7d,
          priceChange30d: live?.priceChange30d ?? p.mockMetrics?.priceChange30d,
        },
        grade: apiRow?.grade || p.grade,
        tier: apiRow?.tier || p.tier,
        scoreChange7d: apiRow?.trend?.score_change ?? p.scoreChange7d ?? 0,
      }
    })

    // Promote every API row not already covered by mock into a synthetic card.
    const apiOnlyProjects = Object.values(apiScores)
      .filter((r) => r?.symbol && !mockSymbols.has(String(r.symbol).toUpperCase()))
      .map((r) => synthesizeProjectFromApi(r, priceMap))

    // Merge curated Onchain Contenders. Each gets the Spectre API logo, name
    // and price changes from priceMap so they render with real branding.
    const contenderSyms = new Set()
    apiOnlyProjects.forEach((p) => contenderSyms.add(String(p.symbol || '').toUpperCase()))
    enrichedMock.forEach((p) => contenderSyms.add(String(p.symbol || '').toUpperCase()))
    const contenders = ONCHAIN_CONTENDERS_SEED
      .filter((p) => !contenderSyms.has(String(p.symbol).toUpperCase()))
      .map((p) => {
        const key = String(p.symbol).toUpperCase()
        const live = priceMap[key]
        if (!live) return p
        // When the seed says to preserve branding (ticker collision on
        // CoinGecko), keep our name/logo and only pull price/market data.
        const name = p.preserveSeedBranding ? p.name : (live.name || p.name)
        const logo = p.preserveSeedBranding ? p.logo : (live.logo || p.logo)
        return {
          ...p,
          name,
          logo,
          mockMetrics: {
            ...p.mockMetrics,
            // Also skip market cap / price when branding is protected — wrong
            // project means the numbers are wrong too.
            marketCap: p.preserveSeedBranding ? p.mockMetrics.marketCap : (live.marketCap ?? p.mockMetrics.marketCap),
            fdv:       p.preserveSeedBranding ? p.mockMetrics.fdv       : (live.fdv       ?? p.mockMetrics.fdv),
            volume24h: p.preserveSeedBranding ? p.mockMetrics.volume24h : (live.volume24h ?? p.mockMetrics.volume24h),
            price:     p.preserveSeedBranding ? p.mockMetrics.price     : (live.price     ?? p.mockMetrics.price),
            priceChange24h: p.preserveSeedBranding ? null : (live.priceChange24h ?? null),
            priceChange7d:  p.preserveSeedBranding ? null : (live.priceChange7d  ?? null),
            priceChange30d: p.preserveSeedBranding ? null : (live.priceChange30d ?? null),
          },
        }
      })

    const merged = [...enrichedMock, ...apiOnlyProjects, ...contenders]
    return merged.map(applySpectreOverride)
  }, [apiScores, priceMap, synthesizeProjectFromApi, applySpectreOverride])

  // Derive Featured Deals from LIVE API data — no more stale 2025 taglines.
  // Picks 4 projects based on real 2026 signals:
  //   1. Biggest weekly upgrade from /v1/institutional/upgrades
  //   2. Institutional heavyweight (top institutional tier by signal count + mcap)
  //   3. Emerging tier leader (top emerging by score)
  //   4. Full-stack signal leader (Grade A+ with most institutional checkboxes)
  // Each pick gets a live-derived `featuredReason` tagline sourced from the
  // actual API response for that project.
  const featuredProjects = useMemo(() => {
    const apiRows = Object.values(apiScores)
    if (apiRows.length === 0) {
      // API not loaded yet — fall back to mock featured list so the carousel
      // still renders something above the fold.
      return enrichedProjects.filter((p) => p.featured)
    }

    // Helper: count active institutional signals (GS / ETF / CME / CB)
    const signalCount = (live) => {
      if (!live) return 0
      const inst = live.institutional || {}
      const oc = live.onchain || {}
      return (
        (inst.grayscale_product ? 1 : 0) +
        (inst.etf_filed ? 1 : 0) +
        (inst.cme_futures ? 1 : 0) +
        (oc.coinbase_listed ? 1 : 0)
      )
    }

    // Live-derived thesis from API data — the actual 2026 story for a project.
    const liveThesis = (project) => {
      const live = project.liveScore
      if (!live) return null
      const parts = []
      if (live.tier === 'institutional') parts.push('Institutional tier')
      else if (live.tier === 'emerging') parts.push('Emerging tier')
      if (live.institutional?.grayscale_product) parts.push('Grayscale product')
      else if (live.institutional?.grayscale_considered) parts.push('Grayscale consideration')
      if (live.institutional?.etf_filed) parts.push('ETF filed')
      if (live.institutional?.cme_futures) parts.push('CME futures')
      if (live.market?.rank && live.market.rank <= 50) parts.push(`Rank #${live.market.rank}`)
      return parts.join(' · ')
    }

    const findProject = (symbol) => {
      if (!symbol) return null
      const key = String(symbol).toUpperCase()
      return enrichedProjects.find((p) => String(p.symbol || '').toUpperCase() === key)
    }

    // Featured Deals must have real live market data. Without it the card
    // renders $0 / dashes and looks broken — better to leave the slot empty
    // (the picker tries the next candidate) than to surface a stale row.
    const hasRealMarketData = (p) => {
      const live = p?.symbol ? priceMap[String(p.symbol).toUpperCase()] : null
      const mcap = live?.marketCap ?? p?.mockMetrics?.marketCap ?? 0
      return Number(mcap) > 0
    }

    const picks = []
    const usedSymbols = new Set()

    // Spectre editorial pins — these must always appear in Featured Deals.
    // Order: ETH (programmable money layer), HYPE (perps DEX leader),
    // TAO (AI compute), FET (ASI alliance). BTC is intentionally excluded —
    // it's a given for every portfolio, Featured Deals is for *picks* with
    // actionable theses.
    const pinnedSymbols = ['ETH', 'HYPE', 'TAO', 'FET']
    // Symbols we never want to see in Featured Deals even as dynamic picks.
    const excludedFromFeatured = new Set(['BTC'])
    for (const sym of pinnedSymbols) {
      const p = findProject(sym)
      if (!p) continue
      if (!hasRealMarketData(p)) continue
      const reason = p.spectreNote || p.tagline || `Spectre Pick · Grade ${p.grade || '—'}`
      picks.push({ ...p, featuredReason: `Spectre Pick · ${reason}` })
      usedSymbols.add(p.symbol)
    }
    excludedFromFeatured.forEach((s) => usedSymbols.add(s))

    // Pick: Biggest weekly upgrade (from /upgrades feed)
    const bullishSorted = (upgradesSignals || [])
      .filter((s) => s.direction === 'bullish')
      .sort((a, b) => (b.data?.score_change || 0) - (a.data?.score_change || 0))
    for (const signal of bullishSorted) {
      const p = findProject(signal.asset)
      if (p && !usedSymbols.has(p.symbol) && hasRealMarketData(p)) {
        const delta = signal.data?.score_change || 0
        const newGrade = signal.data?.grade || '—'
        const prevGrade = signal.data?.prev_grade || '—'
        picks.push({
          ...p,
          featuredReason: `Biggest upgrade · 7d · ${prevGrade}→${newGrade} (+${delta})`,
        })
        usedSymbols.add(p.symbol)
        break
      }
    }

    // Pick 2: Top institutional heavyweight by signal count + mcap
    const institutionalList = enrichedProjects
      .filter((p) => (p.tier || p.liveScore?.tier) === 'institutional')
      .sort((a, b) => {
        const sa = signalCount(a.liveScore)
        const sb = signalCount(b.liveScore)
        if (sb !== sa) return sb - sa
        return (b.mockMetrics?.marketCap || 0) - (a.mockMetrics?.marketCap || 0)
      })
    for (const p of institutionalList) {
      if (usedSymbols.has(p.symbol)) continue
      if (!hasRealMarketData(p)) continue
      const count = signalCount(p.liveScore)
      picks.push({
        ...p,
        featuredReason: count === 4
          ? 'Full institutional signal stack · GS · ETF · CME · CB'
          : `Institutional heavyweight · ${count}/4 signal stack`,
      })
      usedSymbols.add(p.symbol)
      break
    }

    // Pick 3: Top emerging-tier leader (recently upgraded or highest emerging score)
    const emergingList = enrichedProjects
      .filter((p) => (p.tier || p.liveScore?.tier) === 'emerging')
      .sort((a, b) => {
        const da = a.scoreChange7d || 0
        const db = b.scoreChange7d || 0
        if (db !== da) return db - da
        return (b.spectreScore?.overall || 0) - (a.spectreScore?.overall || 0)
      })
    for (const p of emergingList) {
      if (usedSymbols.has(p.symbol)) continue
      if (!hasRealMarketData(p)) continue
      const delta = p.scoreChange7d || 0
      picks.push({
        ...p,
        featuredReason: delta > 0
          ? `Emerging tier leader · +${delta} this week`
          : 'Emerging tier leader · approaching institutional',
      })
      usedSymbols.add(p.symbol)
      break
    }

    // Pick 4: Second institutional heavyweight OR second biggest upgrade
    for (const p of institutionalList) {
      if (usedSymbols.has(p.symbol)) continue
      if (!hasRealMarketData(p)) continue
      const thesis = liveThesis(p)
      picks.push({
        ...p,
        featuredReason: thesis || `Institutional tier · Grade ${p.grade}`,
      })
      usedSymbols.add(p.symbol)
      break
    }

    // If we still don't have 5, pad from the broader universe by score.
    // 5 slots = 3 Spectre pins (HYPE/TAO/FET) + 2 dynamic picks.
    const MAX_FEATURED = 5
    if (picks.length < MAX_FEATURED) {
      const sortedByScore = [...enrichedProjects]
        .filter((p) => !p.onchainContender)
        .filter(hasRealMarketData)
        .sort((a, b) => (b.spectreScore?.overall || 0) - (a.spectreScore?.overall || 0))
      for (const p of sortedByScore) {
        if (picks.length >= MAX_FEATURED) break
        if (usedSymbols.has(p.symbol)) continue
        picks.push({
          ...p,
          featuredReason: liveThesis(p) || `Grade ${p.grade || '—'} · Score ${p.spectreScore?.overall || 0}`,
        })
        usedSymbols.add(p.symbol)
      }
    }

    return picks.slice(0, MAX_FEATURED)
  }, [enrichedProjects, apiScores, upgradesSignals, priceMap])

  const aggregateStats = useMemo(() => {
    const apiRows = Object.values(apiScores)
    const hasApi = apiRows.length > 0

    // Grade distribution — always compute across the full enriched universe
    // so the mini-bar visualization works in both modes.
    const gradeDist = { S: 0, A: 0, B: 0, C: 0, D: 0, F: 0 }
    const source = hasApi ? apiRows : enrichedProjects
    source.forEach((r) => {
      // API rows have .grade directly; enrichedProjects synthesize grade from score
      const g = r.grade ?? (
        r.spectreScore?.overall >= 85 ? 'S' :
        r.spectreScore?.overall >= 75 ? 'A' :
        r.spectreScore?.overall >= 60 ? 'B' :
        r.spectreScore?.overall >= 45 ? 'C' :
        r.spectreScore?.overall >= 30 ? 'D' : 'F'
      )
      if (gradeDist[g] != null) gradeDist[g] += 1
    })

    // Count of Grade A+ institutional-worthy assets (replaces the bogus
    // "Bullish 24h" stat which couldn't be computed for API-only projects).
    const aPlusCount = gradeDist.S + gradeDist.A

    if (hasApi) {
      const totalMcap = apiRows.reduce((s, r) => s + (r.market?.market_cap || 0), 0)
      const avgScore = Math.round(apiRows.reduce((s, r) => s + (r.score || 0), 0) / apiRows.length)
      return {
        totalMcap, avgScore,
        projectCount: apiRows.length,
        aPlusCount,
        gradeDist,
        dataMode: 'live',
      }
    }

    // Fallback: compute from mock data — guarded for contender rows.
    const totalMcap = enrichedProjects.reduce((sum, p) => sum + (liveRow(p)?.marketCap || p.mockMetrics?.marketCap || 0), 0)
    const denom = enrichedProjects.length || 1
    const avgScore = Math.round(enrichedProjects.reduce((sum, p) => sum + (p.spectreScore?.overall || 0), 0) / denom)
    return {
      totalMcap, avgScore,
      projectCount: enrichedProjects.length,
      aPlusCount,
      gradeDist,
      dataMode: 'mock',
    }
  }, [priceMap, enrichedProjects, apiScores, liveRow])

  // Broader institutional criteria — the strict `tier === 'institutional'`
  // filter only surfaced 5 assets which felt artificially narrow. This widens
  // the definition to include any of: core tier, grade A/S, any real
  // institutional signal (Grayscale product, ETF filed, CME futures), or
  // top-50-by-rank with a non-trivial score. TAO, BTC, ETH, SOL, BNB, XRP,
  // AVAX, ADA, DOT, LINK, DOGE and friends all qualify organically.
  const isBroadInstitutional = useCallback((p) => {
    const tier = p.tier || p.liveScore?.tier
    if (tier === 'institutional') return true
    const grade = p.grade || p.liveScore?.grade
    if (grade === 'A' || grade === 'S') return true
    const inst = p.liveScore?.institutional || {}
    if (inst.grayscale_product || inst.etf_filed || inst.cme_futures) return true
    const rank = p.liveScore?.market?.rank ?? 999
    const score = p.spectreScore?.overall ?? p.liveScore?.score ?? 0
    if (rank <= 50 && score >= 50) return true
    return false
  }, [])

  // Per-tab counts. Contenders pull from the curated seed set; institutional
  // uses the broader definition above.
  const tabCounts = useMemo(() => {
    let inst = 0, grow = 0, disc = 0, cont = 0
    enrichedProjects.forEach((p) => {
      if (p.onchainContender) { cont += 1; return }
      if (isBroadInstitutional(p)) inst += 1
      const tier = p.tier || p.liveScore?.tier
      if (tier === 'emerging') grow += 1
      else if (tier === 'speculative') disc += 1
    })
    return {
      all: enrichedProjects.length,
      institutional: inst,
      growth: grow,
      discovery: disc,
      contenders: cont,
    }
  }, [enrichedProjects, isBroadInstitutional])

  const filteredProjects = useMemo(() => {
    let list = [...enrichedProjects]

    // Tab filter (before stage/category/search). `Onchain Contenders` is the
    // curated seed set; other tabs use the tier classification with a broader
    // institutional definition so blue chips like TAO, SOL, AVAX etc. show up.
    // `All Deals` includes everything (its tooltip promises "Every tracked
    // project, no filter."); narrower tabs hide contender-only rows so they
    // don't pollute Institutional / Growth / Discovery.
    if (activeTab === 'contenders') {
      list = list.filter((p) => p.onchainContender === true)
    } else if (activeTab !== 'all') {
      list = list.filter((p) => !p.onchainContender)
    }

    if (activeTab === 'institutional') {
      list = list.filter(isBroadInstitutional)
    } else if (activeTab === 'growth') {
      list = list.filter((p) => {
        const tier = p.tier || p.liveScore?.tier
        if (tier) return tier === 'emerging'
        // Fallback: middle-tier score
        const s = p.spectreScore?.overall || 0
        return s >= 55 && s < 75
      })
    } else if (activeTab === 'discovery') {
      list = list.filter((p) => {
        const tier = p.tier || p.liveScore?.tier
        if (tier) return tier === 'speculative'
        // Fallback: sub-$500M market cap
        const mcap = liveRow(p)?.marketCap || p.mockMetrics?.marketCap || 0
        return mcap < 500e6
      })
    }

    // Search filter — defensive against null fields (contenders seeded without
    // a tagline, API-only rows with no category, etc.)
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase().trim()
      if (q) {
        list = list.filter((p) => {
          const name = (p.name || '').toLowerCase()
          const symbol = (p.symbol || '').toLowerCase()
          const category = (p.category || '').toLowerCase()
          const tagline = (p.tagline || '').toLowerCase()
          return name.includes(q) || symbol.includes(q) || category.includes(q) || tagline.includes(q)
        })
      }
    }

    // Stage filter
    if (stageFilter !== 'all') {
      list = list.filter(p => {
        const mcap = liveRow(p)?.marketCap || p.mockMetrics?.marketCap
        const stage = getStageFromMarketCap(mcap)
        return stage === stageFilter
      })
    }

    // Category filter
    if (categoryFilter !== 'all') {
      list = list.filter(p => p.category === categoryFilter)
    }

    // Sort — decorate-sort-undecorate so liveRow() is called once per project
    // per sort rather than N log N times inside the comparator.
    if (sortBy === 'score') {
      const decorated = list.map(p => [p, p.spectreScore?.overall ?? 0])
      decorated.sort((a, b) => b[1] - a[1])
      list = decorated.map(([p]) => p)
    } else if (sortBy === 'mcap') {
      const decorated = list.map(p => [p, liveRow(p)?.marketCap || p.mockMetrics?.marketCap || 0])
      decorated.sort((a, b) => b[1] - a[1])
      list = decorated.map(([p]) => p)
    } else if (sortBy === 'change') {
      const decorated = list.map(p => [p, liveRow(p)?.priceChange24h ?? p.mockMetrics?.priceChange24h ?? 0])
      decorated.sort((a, b) => b[1] - a[1])
      list = decorated.map(([p]) => p)
    } else if (sortBy === 'name') {
      const decorated = list.map(p => [p, (p.name || p.symbol || '')])
      decorated.sort((a, b) => a[1].localeCompare(b[1]))
      list = decorated.map(([p]) => p)
    }

    return list
  }, [stageFilter, categoryFilter, sortBy, debouncedSearchQuery, priceMap, enrichedProjects, activeTab, isBroadInstitutional, liveRow])

  const handleProjectClick = useCallback((project) => {
    setSelectedProject(project)
  }, [])

  const handleClosePanel = useCallback(() => {
    setSelectedProject(null)
  }, [])

  // When the user clicks a Market Pulse row, jump to that project's detail
  // panel by looking it up across the enriched universe.
  const handlePulseSymbolClick = useCallback((symbol) => {
    if (!symbol) return
    const key = String(symbol).toUpperCase()
    const match = enrichedProjects.find(
      (p) => String(p.symbol || '').toUpperCase() === key,
    )
    if (match) setSelectedProject(match)
  }, [enrichedProjects])

  // Get unique categories from our data
  const activeCategories = useMemo(() => {
    const cats = new Set(enrichedProjects.map(p => p.category))
    return [...cats].sort()
  }, [enrichedProjects])

  // Get unique stages from our data — guard mockMetrics access since curated
  // contenders may not have market cap values yet.
  const activeStages = useMemo(() => {
    const stages = new Set(enrichedProjects.map(p => getStageFromMarketCap(liveRow(p)?.marketCap || p.mockMetrics?.marketCap)))
    return ALL_STAGES.filter(s => stages.has(s))
  }, [priceMap, enrichedProjects, liveRow])

  // ═══════════════════════════════════════════════════════════════════════════════
  //  MOBILE RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  if (isMobile) {
    const pulseItems = (upgradesSignals || []).slice(0, 10)
    return (
      <div className={`ventures-page mvn-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mvn-content">
          <div className="mvn-header-spacer" aria-hidden="true" />

          {/* Hero block: title + subtitle */}
          <div className="mvn-section mvn-hero">
            <h1 className="mvn-title">
              {viewMode === 'smart-money' ? t('ventures.modes.smartMoneyTitle')
                : viewMode === 'accelerators' ? t('ventures.modes.acceleratorPipelineTitle')
                : t('ventures.title')}
            </h1>
            <p className="mvn-subtitle">
              {viewMode === 'smart-money'
                ? t('ventures.modes.smartMoneySubtitle')
                : viewMode === 'accelerators'
                ? t('ventures.modes.acceleratorPipelineSubtitle')
                : t('ventures.subtitle')}
            </p>
          </div>

          {/* Mode toggle: Smart Money / Deal Flow / Accelerators */}
          <div className="mvn-section mvn-mode-wrap">
            <div className="mvn-mode" role="tablist" aria-label={t('ventures.aria.venturesMode', 'Ventures mode')}>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'smart-money'}
                className={`mvn-mode-btn${viewMode === 'smart-money' ? ' mvn-mode-btn--active' : ''}`}
                onClick={() => setViewMode('smart-money')}
              >
                {t('ventures.modes.smartMoney')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'deals'}
                className={`mvn-mode-btn${viewMode === 'deals' ? ' mvn-mode-btn--active' : ''}`}
                onClick={() => setViewMode('deals')}
              >
                {t('ventures.modes.dealFlow')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'accelerators'}
                className={`mvn-mode-btn${viewMode === 'accelerators' ? ' mvn-mode-btn--active' : ''}`}
                onClick={() => setViewMode('accelerators')}
              >
                {t('ventures.modes.accelerators')}
              </button>
            </div>
          </div>

          {viewMode === 'smart-money' && (
            <div className="mvn-section mvn-mode-panel">
              <Suspense fallback={null}>
                <VCIntelHub />
              </Suspense>
            </div>
          )}

          {viewMode === 'accelerators' && (
            <div className="mvn-section mvn-mode-panel">
              <Suspense fallback={null}>
                <AcceleratorFeed />
              </Suspense>
            </div>
          )}

          {viewMode === 'deals' && (
          <>
          {/* Stats horizontal strip - replaces the 2x2 grid.
              LIVE/CACHED pill + 4 compact stats in a scroll rail. */}
          <div className="mvn-section-flush">
            <div className="mvn-stats-strip">
              <div className={`mvn-stat-pill mvn-stat-pill--${aggregateStats.dataMode}`}>
                <span className="mvn-stat-pill-dot" aria-hidden="true" />
                {aggregateStats.dataMode === 'live' ? t('ventures.stats.live') : t('ventures.stats.cached')}
              </div>
              <div className="mvn-stat-chip">
                <span className="mvn-stat-chip-value">{aggregateStats.projectCount}</span>
                <span className="mvn-stat-chip-label">{t('ventures.stats.projects')}</span>
              </div>
              <div className="mvn-stat-chip">
                <span className="mvn-stat-chip-value">{fmtMoney(aggregateStats.totalMcap)}</span>
                <span className="mvn-stat-chip-label">{t('ventures.stats.totalMcap')}</span>
              </div>
              <div className="mvn-stat-chip">
                <span className="mvn-stat-chip-value" style={{ color: getScoreColor(aggregateStats.avgScore) }}>
                  {aggregateStats.avgScore}
                </span>
                <span className="mvn-stat-chip-label">{t('ventures.stats.avgScoreShort', 'Avg Score')}</span>
              </div>
              <div className="mvn-stat-chip">
                <span className="mvn-stat-chip-value mvn-stat-chip-value--bull">{aggregateStats.aPlusCount}</span>
                <span className="mvn-stat-chip-label">{t('ventures.stats.gradeAPlus', 'Grade A+')}</span>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="mvn-section">
            <div className="mvn-search-wrap">
              <svg className="mvn-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="mvn-search"
                placeholder={t('ventures.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="mvn-search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label={t('ventures.clearSearch')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Market Pulse 7d - horizontal scroll strip of grade upgrades/downgrades */}
          {(upgradesLoading || pulseItems.length > 0) && (
            <div className="mvn-section-flush">
              <div className="mvn-section-header">
                <span className="mvn-section-label">
                  <span className="mvn-pulse-dot" aria-hidden="true" />
                  {t('ventures.marketPulse7d', 'Market Pulse · 7d')}
                </span>
              </div>
              <div className="mvn-pulse-strip">
                {upgradesLoading && pulseItems.length === 0
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <span key={i} className="mvn-pulse-skel" />
                    ))
                  : pulseItems.map((s, i) => {
                      const up = s.direction === 'bullish'
                      const change = s.data?.score_change
                      return (
                        <button
                          type="button"
                          key={`${s.asset}-${i}`}
                          className={`mvn-pulse-pill${up ? ' mvn-pulse-pill--up' : ' mvn-pulse-pill--down'}`}
                          onClick={() => handlePulseSymbolClick(s.asset)}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            {up ? <polyline points="5 15 12 8 19 15" /> : <polyline points="5 9 12 16 19 9" />}
                          </svg>
                          <span className="mvn-pulse-pill-sym">{s.asset}</span>
                          <span className="mvn-pulse-pill-arrow">
                            <span className="mvn-pulse-pill-from">{s.data?.prev_grade || '—'}</span>
                            <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                            <span className="mvn-pulse-pill-to">{s.data?.grade || '—'}</span>
                          </span>
                          {change != null && (
                            <span className="mvn-pulse-pill-delta">
                              {change > 0 ? '+' : ''}{change}
                            </span>
                          )}
                        </button>
                      )
                    })}
              </div>
            </div>
          )}

          {/* Deal category tabs (now up here, ahead of featured) */}
          <div className="mvn-section-flush mvn-tabs-wrap">
            <div className="mvn-tabs" role="tablist" aria-label={t('ventures.aria.dealFlowCategory', 'Deal flow category')}>
              {VENTURES_TABS.map((tab) => {
                const active = activeTab === tab.value
                const count = tabCounts[tab.value]
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`mvn-tab${active ? ' mvn-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.value)}
                  >
                    <span className="mvn-tab-label">{t(tab.labelKey)}</span>
                    {typeof count === 'number' && (
                      <span className="mvn-tab-count">{count}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Featured Deals - only on All tab, no search */}
          {!searchQuery && activeTab === 'all' && featuredProjects.length > 0 && (
            <div className="mvn-section-flush">
              <div className="mvn-section-header">
                <span className="mvn-section-label">{t('ventures.featuredDeals')}</span>
              </div>
              <div className="mvn-featured-scroll">
                {featuredProjects.map((project) => {
                  const metrics = (project.preserveSeedBranding ? null : liveRow(project)) || project.mockMetrics || {}
                  const change = metrics.priceChange24h
                  const hasChange = change != null && Number.isFinite(change)
                  const isPositive = hasChange && change >= 0
                  return (
                    <div
                      key={project.id}
                      className="mvn-featured-card"
                      onClick={() => handleProjectClick(project)}
                    >
                      <div className="mvn-featured-top">
                        <LogoOrFallback logo={project.logo} symbol={project.symbol} size={40} />
                        <SpectreScoreRing
                          score={project.spectreScore.overall}
                          size={40}
                          showLabel={false}
                          showValue={true}
                          dayMode={dayMode}
                          animate={false}
                        />
                      </div>
                      <div className="mvn-featured-name">{project.name}</div>
                      <div className="mvn-featured-ticker">${project.symbol}</div>
                      <div className="mvn-featured-bottom">
                        <span className="mvn-featured-mcap">{fmtMoney(metrics.marketCap)}</span>
                        {hasChange ? (
                          <span
                            className={`mvn-featured-change${isPositive ? ' positive' : ' negative'}`}
                            data-mag={changeMagnitude(change)}
                          >
                            {isPositive ? '+' : ''}{change.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="mvn-featured-change mvn-deal-change--dim">—</span>
                        )}
                      </div>
                      <div className="mvn-featured-pills">
                        {project.category && <span className="mvn-pill-cat">{project.category}</span>}
                        {project.grade && (
                          <span
                            className="mvn-pill-grade"
                            style={{
                              color: gradeColor(project.grade),
                              background: `color-mix(in srgb, ${gradeColor(project.grade)} 14%, transparent)`,
                              borderColor: `color-mix(in srgb, ${gradeColor(project.grade)} 32%, transparent)`,
                            }}
                          >
                            {project.grade}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Filters - single row, compact dropdowns */}
          <div className="mvn-section">
            <div className="mvn-section-header mvn-section-header--row">
              <span className="mvn-section-label">{t('ventures.dealFlow')}</span>
              <span className="mvn-section-count">{filteredProjects.length}</span>
            </div>
            <div className="mvn-filter-dropdowns">
              <VenturesDropdown
                value={stageFilter}
                options={[
                  { value: 'all', label: t('ventures.allStages') },
                  ...activeStages.map(s => ({ value: s, label: s })),
                ]}
                onChange={setStageFilter}
              />
              <VenturesDropdown
                value={categoryFilter}
                options={[
                  { value: 'all', label: t('ventures.allCategories') },
                  ...activeCategories.map(c => ({ value: c, label: c })),
                ]}
                onChange={setCategoryFilter}
              />
              <VenturesDropdown
                value={sortBy}
                options={SORT_KEYS.map(opt => ({ value: opt.value, label: t(opt.key) }))}
                onChange={setSortBy}
              />
            </div>
          </div>

          {/* Deal rows */}
          <div className="mvn-section">
            {filteredProjects.length === 0 ? (
              <div className="mvn-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <p>{t('ventures.noProjectsMatch')}</p>
                <button
                  className="mvn-empty-reset"
                  onClick={() => { setStageFilter('all'); setCategoryFilter('all'); setSearchQuery('') }}
                >
                  {t('ventures.resetFilters')}
                </button>
              </div>
            ) : (
              <div className="mvn-deal-list">
                {filteredProjects.map((project) => {
                  const metrics = (project.preserveSeedBranding ? null : liveRow(project)) || project.mockMetrics || {}
                  const change = metrics.priceChange24h
                  const change7d = metrics.priceChange7d
                  const isPositive = change >= 0
                  const grade = project.grade || project.liveScore?.grade
                  const categoryRgb = CATEGORY_COLORS[project.category] || '156, 163, 175'
                  return (
                    <div
                      key={project.id}
                      className="mvn-deal-row"
                      onClick={() => handleProjectClick(project)}
                      style={{ '--row-rgb': categoryRgb }}
                    >
                      <div className="mvn-deal-left">
                        <LogoOrFallback logo={project.logo} symbol={project.symbol} size={40} />
                        <div className="mvn-deal-info">
                          <div className="mvn-deal-name-row">
                            <span className="mvn-deal-name">{project.name || project.symbol}</span>
                            {grade && (
                              <span
                                className="mvn-deal-grade"
                                style={{
                                  color: gradeColor(grade),
                                  background: `color-mix(in srgb, ${gradeColor(grade)} 14%, transparent)`,
                                  borderColor: `color-mix(in srgb, ${gradeColor(grade)} 32%, transparent)`,
                                }}
                              >
                                {grade}
                              </span>
                            )}
                          </div>
                          <div className="mvn-deal-meta">
                            <span className="mvn-deal-ticker">${project.symbol}</span>
                            {project.category && (
                              <>
                                <span className="mvn-deal-sep">·</span>
                                <span className="mvn-deal-cat">{project.category}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mvn-deal-right">
                        <SpectreScoreRing
                          score={project.spectreScore.overall}
                          size={32}
                          showLabel={false}
                          showValue={true}
                          dayMode={dayMode}
                          animate={false}
                        />
                        <div className="mvn-deal-numbers">
                          <span className="mvn-deal-mcap">
                            {metrics.marketCap != null ? fmtMoney(metrics.marketCap) : '—'}
                          </span>
                          {change != null && !Number.isNaN(change) ? (
                            <span
                              className={`mvn-deal-change${isPositive ? ' positive' : ' negative'}`}
                              data-mag={changeMagnitude(change)}
                            >
                              {isPositive ? '+' : ''}{change.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="mvn-deal-change mvn-deal-change--dim">—</span>
                          )}
                          {change7d != null && !Number.isNaN(change7d) && (
                            <span className={`mvn-deal-7d${change7d >= 0 ? ' positive' : ' negative'}`}>
                              7d {change7d >= 0 ? '+' : ''}{change7d.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          </>
          )}

          {/* Bottom spacer for nav clearance */}
          <div className="mvn-bottom-spacer" />
        </div>

        {/* Detail Panel - reuse desktop component */}
        {selectedProject && (
          <Suspense fallback={null}>
            <VenturesDetailPanel
              project={selectedProject}
              onClose={handleClosePanel}
              dayMode={dayMode}
              onOpenResearchZone={onOpenResearchZone}
              addToWatchlist={addToWatchlist}
              isInWatchlist={isInWatchlist}
              selectToken={selectToken}
              liveData={liveRow(selectedProject) || null}
            />
          </Suspense>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  //  DESKTOP RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  return (
    <div className={`ventures-page ${dayMode ? 'day-mode' : ''}`}>
      <div className="ventures-page-noise" />

      <div className="ventures-container">
        {/* Page Header */}
        <header className="ventures-header">
          <div className="ventures-header-text">
            <h1 className="ventures-title">
              {viewMode === 'smart-money' ? t('ventures.modes.smartMoneyTitle')
                : viewMode === 'accelerators' ? t('ventures.modes.acceleratorPipelineTitle')
                : t('ventures.title')}
              {viewMode !== 'smart-money' && (
                <FreshnessTag
                  timestamp={pricesLastUpdated}
                  tier="warm"
                  className="ventures-freshness"
                />
              )}
              <InfoTip text={
                viewMode === 'smart-money'
                  ? t('ventures.tips.smartMoney', 'The crypto VCs, asset managers, corporate treasuries and sovereigns that move markets — with their known token holdings and portfolio companies on record.')
                : viewMode === 'accelerators'
                  ? t('ventures.tips.accelerators', 'Crypto-native startups being incubated by Y Combinator. Refreshed daily from the public yc-oss feed.')
                : t('ventures.tips.dealFlow', 'Angel investor-style token discovery. Each project is evaluated like a startup with a Spectre Score, VC-level due diligence, team analysis, tokenomics breakdown, and smart money tracking.')}
                position="bottom"
              />
            </h1>
            <p className="ventures-subtitle">
              {viewMode === 'smart-money'
                ? t('ventures.modes.smartMoneySubtitle')
                : viewMode === 'accelerators'
                ? t('ventures.modes.acceleratorPipelineSubtitle')
                : t('ventures.subtitle')}
            </p>
          </div>
          <div className="ventures-header-actions">
            <div className="ventures-mode-toggle" role="tablist" aria-label={t('ventures.aria.venturesMode', 'Ventures mode')}>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'smart-money'}
                className={`ventures-mode-btn${viewMode === 'smart-money' ? ' ventures-mode-btn--active' : ''}`}
                onClick={() => setViewMode('smart-money')}
              >
                {t('ventures.modes.smartMoney')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'deals'}
                className={`ventures-mode-btn${viewMode === 'deals' ? ' ventures-mode-btn--active' : ''}`}
                onClick={() => setViewMode('deals')}
              >
                {t('ventures.modes.dealFlow')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'accelerators'}
                className={`ventures-mode-btn${viewMode === 'accelerators' ? ' ventures-mode-btn--active' : ''}`}
                onClick={() => setViewMode('accelerators')}
              >
                {t('ventures.modes.accelerators')}
              </button>
            </div>
            {viewMode === 'deals' && (
              <div className="ventures-search-wrap">
                <svg className="ventures-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="ventures-search"
                  placeholder={t('ventures.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    className="ventures-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label={t('ventures.clearSearch')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Non-deals modes swap out the entire deal flow for a dedicated surface */}
        {viewMode === 'smart-money' ? (
          <Suspense fallback={null}><VCIntelHub /></Suspense>
        ) : viewMode === 'accelerators' ? (
          <Suspense fallback={null}><AcceleratorFeed /></Suspense>
        ) : (
          <>

        {/* Aggregate Market Pulse */}
        <div className="ventures-stats-bar">
          <div className={`ventures-data-pill ventures-data-pill--${aggregateStats.dataMode}`}>
            <span className="ventures-data-pill-dot" aria-hidden="true" />
            {aggregateStats.dataMode === 'live' ? t('ventures.stats.live') : t('ventures.stats.cached')}
          </div>
          <div className="ventures-stat-item">
            <span className="ventures-stat-item-value">{aggregateStats.projectCount}</span>
            <span className="ventures-stat-item-label">{t('ventures.stats.projectsTracked')}<InfoTip text={t('ventures.tips.projectsTracked', 'Total number of crypto projects under active Spectre evaluation. Each is scored on fundamentals, team, tokenomics, community, and smart money signals.')} position="bottom" /></span>
          </div>
          <div className="ventures-stats-sep" />
          <div className="ventures-stat-item">
            <span className="ventures-stat-item-value">{fmtMoney(aggregateStats.totalMcap)}</span>
            <span className="ventures-stat-item-label">{t('ventures.stats.totalMarketCap')}<InfoTip text={t('ventures.tips.totalMarketCap', 'Combined market capitalization of all projects in the Ventures universe.')} position="bottom" /></span>
          </div>
          <div className="ventures-stats-sep" />
          <div className="ventures-stat-item">
            <span className="ventures-stat-item-value" style={{ color: getScoreColor(aggregateStats.avgScore) }}>
              {aggregateStats.avgScore}
            </span>
            <span className="ventures-stat-item-label">{t('ventures.stats.avgSpectreScore')}<InfoTip text={t('ventures.tips.avgSpectreScore', 'Mean Spectre Score across all tracked projects (0–100). Combines fundamentals, team quality, tokenomics health, community sentiment, and smart money activity.')} position="bottom" /></span>
          </div>
          <div className="ventures-stats-sep" />
          <div className="ventures-stat-item">
            <span className="ventures-stat-item-value ventures-stat-positive">
              {aggregateStats.aPlusCount}
            </span>
            <span className="ventures-stat-item-label">{t('ventures.stats.aPlusAssets')}<InfoTip text={t('ventures.tips.aPlusAssets', 'Count of projects rated Grade S or A — institutional-worthy assets meeting the criteria Grayscale / ETF issuers look for. Updated live from api.spectreai.io.')} position="bottom" /></span>
          </div>
        </div>

        {/* Three-tab navigation: moved directly under the stats bar so it's
            visible without scrolling past the Featured Deals + Pulse blocks. */}
        <nav className="ventures-tabs ventures-tabs--sticky" role="tablist" aria-label={t('ventures.aria.dealFlowCategory', 'Deal flow category')}>
          {VENTURES_TABS.map((tab) => {
            const active = activeTab === tab.value
            const count = tabCounts[tab.value]
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-variant={tab.value}
                className={`ventures-tab${active ? ' ventures-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.value)}
              >
                <span className="ventures-tab-label">{t(tab.labelKey)}</span>
                {typeof count === 'number' && (
                  <span className="ventures-tab-count">{count}</span>
                )}
                <InfoTip text={t(tab.tipKey, tab.tipDefault)} position="bottom" />
              </button>
            )
          })}
        </nav>

        {scoresAsOf && Date.now() - scoresAsOf > 7 * 86_400_000 ? (
          <p className="ventures-scores-asof">
            {t('ventures.scoresAsOf', 'Spectre Scores below were last computed {{date}} — the tabs filter on those figures, not on today\u2019s market.', {
              date: new Date(scoresAsOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            })}
          </p>
        ) : null}

        {/* Market Pulse — compact ticker-tape variant */}
        <MarketPulseStrip
          signals={upgradesSignals}
          loading={upgradesLoading}
          degraded={upgradesDegraded}
          onSymbolClick={handlePulseSymbolClick}
        />

        {/* Featured Deals — only on the "All Deals" tab so switching tabs
            actually changes what's visible. Hidden during search too. */}
        {!searchQuery && activeTab === 'all' && featuredProjects.length > 0 && (
          <VenturesFeaturedHero
            projects={featuredProjects}
            onProjectClick={handleProjectClick}
            dayMode={dayMode}
            liveDataMap={priceMap}
          />
        )}

        {/* Deal Flow — ALWAYS a dense table. No card grid. */}
        <section className="ventures-dealflow">
          <div className="ventures-dealflow-header ventures-dealflow-header--compact">
            <h2 className="ventures-section-title">
              {t('ventures.dealFlow')}
              <InfoTip text="Bloomberg-style dense table of every tracked project. Sort by any column, click any row to open the deep-dive modal." position="bottom" />
            </h2>
            <div className="ventures-filters">
              <VenturesDropdown
                value={stageFilter}
                options={[
                  { value: 'all', label: t('ventures.allStages') },
                  ...activeStages.map(s => ({ value: s, label: s })),
                ]}
                onChange={setStageFilter}
              />
              <VenturesDropdown
                value={categoryFilter}
                options={[
                  { value: 'all', label: t('ventures.allCategories') },
                  ...activeCategories.map(c => ({ value: c, label: c })),
                ]}
                onChange={setCategoryFilter}
              />
              <VenturesDropdown
                value={sortBy}
                options={SORT_KEYS.map(opt => ({ value: opt.value, label: t(opt.key) }))}
                onChange={setSortBy}
              />
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="ventures-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <p>{t('ventures.noProjectsMatch')}</p>
              <button
                className="ventures-empty-reset"
                onClick={() => {
                  setStageFilter('all')
                  setCategoryFilter('all')
                  setSearchQuery('')
                }}
              >
                {t('ventures.resetFilters')}
              </button>
            </div>
          ) : (
            <div className="ven-table">
              <div className="ven-table-head">
                <div className="ven-row-cell ven-row-cell--rank">{t('ventures.tableHeaders.rank')}</div>
                <div className="ven-row-cell ven-row-cell--project">{t('ventures.tableHeaders.project')}</div>
                <div className="ven-row-cell ven-row-cell--score">{t('ventures.tableHeaders.score')}</div>
                <div className="ven-row-cell ven-row-cell--grade">{t('ventures.tableHeaders.grade')}</div>
                <div className="ven-row-cell ven-row-cell--dims">{t('ventures.tableHeaders.dimensions')}</div>
                <div className="ven-row-cell ven-row-cell--mcap">{t('ventures.tableHeaders.marketCap')}</div>
                <div className="ven-row-cell ven-row-cell--ch">{t('ventures.change24h')}</div>
                <div className="ven-row-cell ven-row-cell--ch">{t('ventures.change7d')}</div>
                <div className="ven-row-cell ven-row-cell--ch">{t('ventures.change30d')}</div>
                <div className="ven-row-cell ven-row-cell--vol">{t('ventures.tableHeaders.volume')}</div>
                <div className="ven-row-cell ven-row-cell--smart">{t('ventures.tableHeaders.smartMoney')}</div>
                <div className="ven-row-cell ven-row-cell--action" />
              </div>
              <div className="ven-table-body">
                {filteredProjects.map((project, index) => (
                  <DealRow
                    key={project.id}
                    project={project}
                    index={index}
                    onClick={handleProjectClick}
                    livePriceRow={project.preserveSeedBranding ? null : (liveRow(project) || null)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
          </>
        )}
      </div>

      {/* Detail Panel */}
      {selectedProject && (
        <Suspense fallback={null}>
          <VenturesDetailPanel
            project={selectedProject}
            onClose={handleClosePanel}
            dayMode={dayMode}
            onOpenResearchZone={onOpenResearchZone}
            addToWatchlist={addToWatchlist}
            isInWatchlist={isInWatchlist}
            selectToken={selectToken}
            liveData={liveRow(selectedProject) || null}
          />
        </Suspense>
      )}
    </div>
  )
}

export default VenturesPage
