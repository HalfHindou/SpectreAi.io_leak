/**
 * Classification → layout config map.
 *
 * The search engine backend classifies queries into 18 categories. Each one
 * implies a different result shape: an asset query needs a chart + dossier
 * rail; a comparison needs side-by-side asset columns; a macro query needs
 * a market-pulse strip; etc. The shell renders blocks in declared order
 * without knowing what's inside them.
 *
 * Two kinds of block:
 *
 *   - String keys (`'answer'`, `'news'`, `'citations'`, `'related'`) refer
 *     to the universal blocks rendered for almost every classification.
 *     They live in STRING_BLOCKS below as lazy-loaded React.lazy components.
 *
 *   - Component references (e.g. `ComparisonGrid`) are classification-
 *     specific. Each one is React.lazy so the bundle only ships the layout
 *     the user actually hits.
 *
 * Rail components are React.lazy too. `null` means the layout is full-width
 * (no rail), and the shell centers the main column.
 */
import lazy from '@/lib/lazy-with-retry'

// Universal blocks (every layout uses most of these)
export const STRING_BLOCKS = {
  answer:    () => lazy(() => import('../components/answer-stream')),
  news:      () => lazy(() => import('../components/news-section')),
  citations: () => lazy(() => import('../components/citations-bar')),
  related:   () => lazy(() => import('../components/related-questions')),
}

// Classification-specific blocks (lazy)
const ComparisonGrid     = lazy(() => import('../components/comparison-grid'))
const MacroNarrativeGrid = lazy(() => import('../components/macro-narrative-grid'))
const DiscoveryGrid      = lazy(() => import('../components/discovery-grid'))
const DerivativesPanel   = lazy(() => import('../components/derivatives-panel'))
const WhalesPanel        = lazy(() => import('../components/whales-panel'))
const RiskScoreHero      = lazy(() => import('../components/risk-score-hero'))
const NewsHeroCard       = lazy(() => import('../components/news-hero-card'))

// Rails (lazy)
const AssetKnowledgePanel = lazy(() => import('../components/asset-knowledge-panel'))
const ComparisonRail      = lazy(() => import('../components/comparison-rail'))
const MarketPulseRail     = lazy(() => import('../components/market-pulse-rail'))
const DiscoveryRail       = lazy(() => import('../components/discovery-rail'))
const NewsRail            = lazy(() => import('../components/news-rail'))

/**
 * The full map. Order of `main` array = render order top-to-bottom.
 * Tested against the 18 classifications the backend emits.
 */
export const CLASSIFICATION_CONFIG = {
  // ── Asset-centric (gets the full dossier rail) ─────────────────────
  ASSET_ANALYSIS: {
    main: ['answer', 'news', 'citations', 'related'],
    rail: AssetKnowledgePanel,
  },
  DUE_DILIGENCE: {
    main: [RiskScoreHero, 'answer', 'news', 'citations', 'related'],
    rail: AssetKnowledgePanel,
  },

  // ── Compare two assets side-by-side ────────────────────────────────
  COMPARISON: {
    main: [ComparisonGrid, 'answer', 'news', 'citations', 'related'],
    rail: ComparisonRail,
  },

  // ── Macro / market-wide ────────────────────────────────────────────
  MARKET_OVERVIEW: {
    main: [MacroNarrativeGrid, 'answer', 'news', 'citations', 'related'],
    rail: MarketPulseRail,
  },
  MACRO: {
    main: [MacroNarrativeGrid, 'answer', 'news', 'citations', 'related'],
    rail: MarketPulseRail,
  },
  STABLECOINS: {
    main: ['answer', 'news', 'citations', 'related'],
    rail: MarketPulseRail,
  },
  MINDSHARE: {
    main: ['answer', 'news', 'citations', 'related'],
    rail: MarketPulseRail,
  },

  // ── Derivatives focus ──────────────────────────────────────────────
  DERIVATIVES: {
    main: [DerivativesPanel, 'answer', 'citations', 'related'],
    // No rail — derivatives panel is wide and needs full width.
    rail: null,
  },

  // ── On-chain / whale focus ─────────────────────────────────────────
  WHALE_TRACKING: {
    main: [WhalesPanel, 'answer', 'citations', 'related'],
    rail: AssetKnowledgePanel,
  },
  ONCHAIN: {
    main: [WhalesPanel, 'answer', 'citations', 'related'],
    rail: null,
  },

  // ── News-first ─────────────────────────────────────────────────────
  NEWS: {
    main: [NewsHeroCard, 'news', 'answer', 'citations', 'related'],
    rail: NewsRail,
  },

  // ── Discovery / movers / memes ─────────────────────────────────────
  DISCOVERY: {
    main: [DiscoveryGrid, 'answer', 'citations', 'related'],
    rail: DiscoveryRail,
  },
  MOVERS: {
    main: [DiscoveryGrid, 'answer', 'citations', 'related'],
    rail: DiscoveryRail,
  },
  MEME_ALPHA: {
    main: [DiscoveryGrid, 'answer', 'citations', 'related'],
    rail: DiscoveryRail,
  },

  // ── DeFi / NFT / wallet — generic shape for now ────────────────────
  DEFI: {
    main: ['answer', 'news', 'citations', 'related'],
    rail: MarketPulseRail,
  },
  NFT: {
    main: ['answer', 'news', 'citations', 'related'],
    rail: null,
  },
  WALLET_LOOKUP: {
    // Backend doesn't yet plan endpoints for wallet queries — render the
    // generic shell so the user at least sees their query echoed back with
    // a "no wallet data yet" message until /v1/wallet/:address ships.
    main: ['answer', 'citations', 'related'],
    rail: null,
  },

  // ── Default ────────────────────────────────────────────────────────
  GENERAL: {
    main: ['answer', 'citations', 'related'],
    rail: null,
  },
}
