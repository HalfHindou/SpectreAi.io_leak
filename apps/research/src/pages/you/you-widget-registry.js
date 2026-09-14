import lazy from '@/lib/lazy-with-retry'
// Shared design-system primitives for all Trader's Corner widgets (shimmer,
// labels, bull/bear helpers, empty state) + their day-mode overrides.
import '../traders-corner/widgets/_widgets-base.css'

/**
 * Spectre YOU — Widget Registry
 *
 * 36 widgets total:
 * - 24 reused from Trader's Corner (all built, lazy-loaded)
 * - 12 YOU-exclusive widgets (Phase 2)
 *
 * Categories: Metrics, Charts, Flow, Intelligence, Portfolio, YOU
 */

/* ── Metrics ─────────────────────────────────────────────────────── */
const PriceCard          = lazy(() => import('../traders-corner/widgets/PriceCard'))
const FearGreedGauge     = lazy(() => import('../traders-corner/widgets/FearGreedGauge'))
const LiquidationSummary = lazy(() => import('../traders-corner/widgets/LiquidationSummary'))
const OpenInterest       = lazy(() => import('../traders-corner/widgets/OpenInterest'))
const FundingHeatmap     = lazy(() => import('../traders-corner/widgets/FundingHeatmap'))

/* ── Charts ──────────────────────────────────────────────────────── */
const TradingViewChart    = lazy(() => import('../traders-corner/widgets/TradingViewChart'))
const LiquidationBars     = lazy(() => import('../traders-corner/widgets/LiquidationBars'))
const LiquidationBubbles  = lazy(() => import('../traders-corner/widgets/LiquidationBubbles'))
const LiquidationTimeline = lazy(() => import('../traders-corner/widgets/LiquidationTimeline'))
const CVDChart            = lazy(() => import('../traders-corner/widgets/CVDChart'))
const OrderBookDepth      = lazy(() => import('../traders-corner/widgets/OrderBookDepth'))

/* ── Flow & On-Chain ─────────────────────────────────────────────── */
const ExchangeFlows  = lazy(() => import('../traders-corner/widgets/ExchangeFlows'))
const ETFFlows       = lazy(() => import('../traders-corner/widgets/ETFFlows'))
const WhaleAlerts    = lazy(() => import('../traders-corner/widgets/WhaleAlerts'))
const OnChainMetrics = lazy(() => import('../traders-corner/widgets/OnChainMetrics'))

/* ── AI & Intelligence ───────────────────────────────────────────── */
const AIBrief        = lazy(() => import('../traders-corner/widgets/AIBrief'))
const SpectreVerdict = lazy(() => import('../traders-corner/widgets/SpectreVerdict'))
const GhostMode      = lazy(() => import('../traders-corner/widgets/GhostMode'))
const AIScreener     = lazy(() => import('../traders-corner/widgets/AIScreener'))

/* ── Portfolio ───────────────────────────────────────────────────── */
const Watchlist      = lazy(() => import('../traders-corner/widgets/Watchlist'))
const Positions      = lazy(() => import('../traders-corner/widgets/Positions'))
const PortfolioRing  = lazy(() => import('../traders-corner/widgets/PortfolioRing'))
const ActiveAlerts   = lazy(() => import('../traders-corner/widgets/ActiveAlerts'))

/* ── YOU Exclusive Widgets (Phase 2) ─────────────────────────────── */
const YouNewsFeed         = lazy(() => import('./widgets/YouNewsFeed'))
const YouEconomicCalendar = lazy(() => import('./widgets/YouEconomicCalendar'))
const YouNarrativeTracker = lazy(() => import('./widgets/YouNarrativeTracker'))
const YouMacroSignals     = lazy(() => import('./widgets/YouMacroSignals'))
const YouROICalculator    = lazy(() => import('./widgets/YouROICalculator'))
const YouMarketFlows      = lazy(() => import('./widgets/YouMarketFlows'))
const YouDiscovery        = lazy(() => import('./widgets/YouDiscovery'))
const YouCryptoTwitter    = lazy(() => import('./widgets/YouCryptoTwitter'))
const YouTopCoins         = lazy(() => import('./widgets/YouTopCoins'))
const YouHeatmap          = lazy(() => import('./widgets/YouHeatmap'))
const YouPredictionMarkets = lazy(() => import('./widgets/YouPredictionMarkets'))
const YouMindshareRadar    = lazy(() => import('./widgets/YouMindshareRadar'))
const YouPerpFundingSkew   = lazy(() => import('./widgets/YouPerpFundingSkew'))
const YouDexNewPairs       = lazy(() => import('./widgets/YouDexNewPairs'))
const YouRwaOverview       = lazy(() => import('./widgets/YouRwaOverview'))
const YouStockMovers       = lazy(() => import('./widgets/YouStockMovers'))
const YouAiAnswer          = lazy(() => import('./widgets/YouAiAnswer'))
const YouUSMarket          = lazy(() => import('./widgets/YouUSMarket'))
const YouSectorRotation    = lazy(() => import('./widgets/YouSectorRotation'))
const YouTopGainers        = lazy(() => import('./widgets/YouTopGainers'))
const YouMacroPulse        = lazy(() => import('./widgets/YouMacroPulse'))
const YouTokenSearch       = lazy(() => import('./widgets/YouTokenSearch'))
const YouRwaStablecoins    = lazy(() => import('./widgets/YouRwaStablecoins'))
const YouRwaChains         = lazy(() => import('./widgets/YouRwaChains'))
const YouXTrending         = lazy(() => import('./widgets/YouXTrending'))
const YouTokenDossier      = lazy(() => import('./widgets/YouTokenDossier'))
const YouCryptoNewsFeed    = lazy(() => import('./widgets/YouCryptoNewsFeed'))
const YouFearGreedHistory  = lazy(() => import('./widgets/YouFearGreedHistory'))
const YouVentures          = lazy(() => import('./widgets/YouVentures'))
const YouLlamaRaises       = lazy(() => import('./widgets/YouLlamaRaises'))
const YouAccelerators      = lazy(() => import('./widgets/YouAccelerators'))
const YouSecFilings        = lazy(() => import('./widgets/YouSecFilings'))
const YouLiqHeatmap        = lazy(() => import('./widgets/YouLiqHeatmap'))
const YouTradingViewMini   = lazy(() => import('./widgets/YouTradingViewMini'))
const YouUnicorns          = lazy(() => import('./widgets/YouUnicorns'))
const YouEarnings          = lazy(() => import('./widgets/YouEarnings'))
const YouVcSectorHeat      = lazy(() => import('./widgets/YouVcSectorHeat'))


const YOU_REGISTRY = {

  /* ══════════════════════════════════════════════════════════════
     METRICS
     ══════════════════════════════════════════════════════════════ */

  'you-btc-price': {
    id: 'you-btc-price',
    name: 'BTC Price',
    description: 'Bitcoin live price, 24h change, sparkline',
    category: 'Metrics',
    component: PriceCard,
    props: { symbol: 'BTC', name: 'Bitcoin', coingeckoId: 'bitcoin' },
  },
  'you-eth-price': {
    id: 'you-eth-price',
    name: 'ETH Price',
    description: 'Ethereum live price, 24h change, sparkline',
    category: 'Metrics',
    component: PriceCard,
    props: { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
  },
  'you-sol-price': {
    id: 'you-sol-price',
    name: 'SOL Price',
    description: 'Solana live price, 24h change, sparkline',
    category: 'Metrics',
    component: PriceCard,
    props: { symbol: 'SOL', name: 'Solana', coingeckoId: 'solana' },
  },
  'you-bnb-price': {
    id: 'you-bnb-price',
    name: 'BNB Price',
    description: 'BNB live price, 24h change, sparkline',
    category: 'Metrics',
    component: PriceCard,
    props: { symbol: 'BNB', name: 'BNB', coingeckoId: 'binancecoin' },
  },
  'you-fear-greed': {
    id: 'you-fear-greed',
    name: 'Fear & Greed',
    description: 'Crypto Fear & Greed Index gauge with history',
    category: 'Metrics',
    component: FearGreedGauge,
    props: {},
  },
  'you-liq-summary': {
    id: 'you-liq-summary',
    name: 'Liquidations 24h',
    description: '24h liquidation totals, long/short split, daily bars',
    category: 'Metrics',
    component: LiquidationSummary,
    props: {},
  },
  'you-open-interest': {
    id: 'you-open-interest',
    name: 'Open Interest',
    description: 'Aggregate OI value, 24h change, funding rate',
    category: 'Metrics',
    component: OpenInterest,
    props: {},
  },
  'you-funding-heatmap': {
    id: 'you-funding-heatmap',
    name: 'Funding Heatmap',
    description: 'Funding rates across tokens and exchanges',
    category: 'Metrics',
    component: FundingHeatmap,
    props: {},
  },

  /* ══════════════════════════════════════════════════════════════
     CHARTS
     ══════════════════════════════════════════════════════════════ */

  'you-chart': {
    id: 'you-chart',
    name: 'TradingView Chart',
    description: 'Full TradingView chart with timeframes and indicators',
    category: 'Charts',
    component: TradingViewChart,
    props: { symbol: 'BTCUSDT' },
  },
  'you-liq-bars': {
    id: 'you-liq-bars',
    name: 'Liquidation Bars',
    description: 'Horizontal bars showing liquidation clusters above/below price',
    category: 'Charts',
    component: LiquidationBars,
    props: {},
  },
  'you-liq-bubbles': {
    id: 'you-liq-bubbles',
    name: 'Liquidation Bubbles',
    description: 'Bubble map of liquidation clusters by price level',
    category: 'Charts',
    component: LiquidationBubbles,
    props: {},
  },
  'you-liq-timeline': {
    id: 'you-liq-timeline',
    name: 'Liquidation Timeline',
    description: 'Historical liquidation volume with spike detection',
    category: 'Charts',
    component: LiquidationTimeline,
    props: {},
  },
  'you-cvd': {
    id: 'you-cvd',
    name: 'CVD (Volume Delta)',
    description: 'Cumulative volume delta with divergence detection',
    category: 'Charts',
    component: CVDChart,
    props: {},
  },
  'you-orderbook': {
    id: 'you-orderbook',
    name: 'Order Book Depth',
    description: 'Mirrored depth chart with bid/ask ratio',
    category: 'Charts',
    component: OrderBookDepth,
    props: {},
  },

  /* ══════════════════════════════════════════════════════════════
     FLOW & ON-CHAIN
     ══════════════════════════════════════════════════════════════ */

  'you-exchange-flows': {
    id: 'you-exchange-flows',
    name: 'Exchange Flows',
    description: 'Net exchange inflows/outflows with live event feed',
    category: 'Flow',
    component: ExchangeFlows,
    props: {},
  },
  'you-etf-flows': {
    id: 'you-etf-flows',
    name: 'ETF Flows',
    description: 'BTC Spot ETF daily flows — IBIT, FBTC, GBTC, etc.',
    category: 'Flow',
    component: ETFFlows,
    props: {},
  },
  'you-whale-alerts': {
    id: 'you-whale-alerts',
    name: 'Whale Alerts',
    description: 'Live whale transaction feed with chain badges',
    category: 'Flow',
    component: WhaleAlerts,
    props: {},
  },
  'you-onchain': {
    id: 'you-onchain',
    name: 'On-Chain Metrics',
    description: 'Active addresses, exchange reserves, HODL wave, MVRV',
    category: 'Flow',
    component: OnChainMetrics,
    props: {},
  },

  /* ══════════════════════════════════════════════════════════════
     INTELLIGENCE
     ══════════════════════════════════════════════════════════════ */

  'you-ai-brief': {
    id: 'you-ai-brief',
    name: 'AI Brief',
    description: 'One-paragraph market summary from Spectre AI',
    category: 'Intelligence',
    component: AIBrief,
    props: {},
  },
  'you-verdict': {
    id: 'you-verdict',
    name: 'Spectre Verdict',
    description: 'Market stance with signal breakdowns',
    category: 'Intelligence',
    component: SpectreVerdict,
    props: {},
  },
  'you-ghost': {
    id: 'you-ghost',
    name: 'Ghost Mode',
    description: 'Counter-thesis risk briefing with alerts',
    category: 'Intelligence',
    component: GhostMode,
    props: {},
  },
  'you-screener': {
    id: 'you-screener',
    name: 'AI Screener',
    description: 'Token signal table — accumulate, watch, avoid',
    category: 'Intelligence',
    component: AIScreener,
    props: {},
  },

  /* ══════════════════════════════════════════════════════════════
     PORTFOLIO
     ══════════════════════════════════════════════════════════════ */

  'you-watchlist': {
    id: 'you-watchlist',
    name: 'Watchlist',
    description: 'Your tracked tokens with sparklines',
    category: 'Portfolio',
    component: Watchlist,
    props: {},
  },
  'you-positions': {
    id: 'you-positions',
    name: 'Positions',
    description: 'Active trades with P&L, leverage, entry/current',
    category: 'Portfolio',
    component: Positions,
    props: {},
  },
  'you-portfolio-ring': {
    id: 'you-portfolio-ring',
    name: 'Portfolio Ring',
    description: 'Donut chart of portfolio allocation',
    category: 'Portfolio',
    component: PortfolioRing,
    props: {},
  },
  'you-alerts': {
    id: 'you-alerts',
    name: 'Active Alerts',
    description: 'Price alerts with status — watching, triggered, resolved',
    category: 'Portfolio',
    component: ActiveAlerts,
    props: {},
  },

  /* ══════════════════════════════════════════════════════════════
     YOU EXCLUSIVES (Phase 2 — built)
     ══════════════════════════════════════════════════════════════ */

  'you-news-feed': {
    id: 'you-news-feed',
    name: 'News Feed',
    description: 'Latest crypto & market news with sentiment',
    category: 'YOU',
    component: YouNewsFeed,
    props: {},
  },
  'you-economic-calendar': {
    id: 'you-economic-calendar',
    name: 'Economic Calendar',
    description: 'Key macro events with impact levels and timing',
    category: 'YOU',
    component: YouEconomicCalendar,
    props: {},
  },
  'you-narrative-tracker': {
    id: 'you-narrative-tracker',
    name: 'Narrative Tracker',
    description: 'Sector lifecycle stages — Early to Exhausted',
    category: 'YOU',
    component: YouNarrativeTracker,
    props: {},
  },
  'you-macro-signals': {
    id: 'you-macro-signals',
    name: 'Macro Signals',
    description: 'AI-derived market bias, volatility, and positioning',
    category: 'YOU',
    component: YouMacroSignals,
    props: {},
  },
  'you-roi-calculator': {
    id: 'you-roi-calculator',
    name: 'ROI Calculator',
    description: 'Current price vs ATH — what could your investment return?',
    category: 'YOU',
    component: YouROICalculator,
    props: {},
  },
  'you-market-flows': {
    id: 'you-market-flows',
    name: 'Market Flows',
    description: 'Funding, liquidations, whale flows at a glance',
    category: 'YOU',
    component: YouMarketFlows,
    props: {},
  },
  'you-discovery': {
    id: 'you-discovery',
    name: 'Discovery',
    description: 'Trending tokens and top gainers with performance',
    category: 'YOU',
    component: YouDiscovery,
    props: {},
  },
  'you-crypto-twitter': {
    id: 'you-crypto-twitter',
    name: 'Crypto X',
    description: 'Crypto Twitter pulse — trending posts and takes',
    category: 'YOU',
    component: YouCryptoTwitter,
    props: {},
  },
  'you-top-coins': {
    id: 'you-top-coins',
    name: 'Top Coins',
    description: 'Top 10 by market cap with live prices and changes',
    category: 'YOU',
    component: YouTopCoins,
    props: {},
  },
  'you-heatmap': {
    id: 'you-heatmap',
    name: 'Market Heatmap',
    description: 'Top 30 coins as treemap colored by 24h performance',
    category: 'YOU',
    component: YouHeatmap,
    props: {},
  },
  'you-prediction-markets': {
    id: 'you-prediction-markets',
    name: 'Prediction Markets',
    description: 'Polymarket event odds with crypto-relevant filtering',
    category: 'YOU',
    component: YouPredictionMarkets,
    props: { category: 'crypto' },
  },
  'you-mindshare-radar': {
    id: 'you-mindshare-radar',
    name: 'Mindshare Radar',
    description: 'Top sectors by share-of-mentions over the last 24h',
    category: 'YOU',
    component: YouMindshareRadar,
    props: {},
  },
  'you-perp-funding-skew': {
    id: 'you-perp-funding-skew',
    name: 'Perp Funding Skew',
    description: 'Funding skew across exchanges - tokens ranked by spread',
    category: 'YOU',
    component: YouPerpFundingSkew,
    props: {},
  },
  'you-dex-new-pairs': {
    id: 'you-dex-new-pairs',
    name: 'New DEX Pairs',
    description: 'Freshly listed DEX pairs across chains via DexScreener',
    category: 'YOU',
    component: YouDexNewPairs,
    props: {},
  },
  'you-rwa-overview': {
    id: 'you-rwa-overview',
    name: 'RWA Overview',
    description: 'Real-world asset TVL, top protocols, and 24h movers',
    category: 'YOU',
    component: YouRwaOverview,
    props: {},
  },
  'you-stock-movers': {
    id: 'you-stock-movers',
    name: 'Stock Movers',
    description: 'Top US equity gainers and losers',
    category: 'YOU',
    component: YouStockMovers,
    props: {},
  },
  'you-ai-answer': {
    id: 'you-ai-answer',
    name: 'Ask Spectre',
    description: 'Quick AI question - fast lookup inside the dashboard',
    category: 'YOU',
    component: YouAiAnswer,
    props: {},
  },
  'you-us-market': {
    id: 'you-us-market',
    name: 'US Indices',
    description: 'S&P 500, Nasdaq, Dow, Russell - live levels',
    category: 'YOU',
    component: YouUSMarket,
    props: {},
  },
  'you-sector-rotation': {
    id: 'you-sector-rotation',
    name: 'Sector Rotation',
    description: 'Crypto sectors leaders and laggards over 24h',
    category: 'YOU',
    component: YouSectorRotation,
    props: {},
  },
  'you-top-gainers': {
    id: 'you-top-gainers',
    name: 'Top Movers',
    description: 'Top crypto gainers and losers in 24h',
    category: 'YOU',
    component: YouTopGainers,
    props: {},
  },
  'you-macro-pulse': {
    id: 'you-macro-pulse',
    name: 'Macro Pulse',
    description: 'Total crypto mcap, BTC dominance, ETH dominance',
    category: 'YOU',
    component: YouMacroPulse,
    props: {},
  },
  'you-token-search': {
    id: 'you-token-search',
    name: 'Whisper Search',
    description: 'Natural-language token search powered by Spectre AI',
    category: 'YOU',
    component: YouTokenSearch,
    props: {},
  },
  'you-rwa-stablecoins': {
    id: 'you-rwa-stablecoins',
    name: 'RWA Stablecoins',
    description: 'Tokenized stablecoins TVL breakdown',
    category: 'YOU',
    component: YouRwaStablecoins,
    props: {},
  },
  'you-rwa-chains': {
    id: 'you-rwa-chains',
    name: 'RWA Chains',
    description: 'Real-world asset TVL by blockchain',
    category: 'YOU',
    component: YouRwaChains,
    props: {},
  },
  'you-x-trending': {
    id: 'you-x-trending',
    name: 'X Trending',
    description: 'Top tokens by X/Twitter mentions in the last 24h',
    category: 'YOU',
    component: YouXTrending,
    props: {},
  },
  'you-token-dossier': {
    id: 'you-token-dossier',
    name: 'Token Dossier',
    description: 'Spectre Dossier - identity, market, safety for the selected token',
    category: 'YOU',
    component: YouTokenDossier,
    props: {},
  },
  'you-crypto-news': {
    id: 'you-crypto-news',
    name: 'Crypto News',
    description: 'Crypto-only news feed with sentiment dots',
    category: 'YOU',
    component: YouCryptoNewsFeed,
    props: {},
  },
  'you-fear-greed-history': {
    id: 'you-fear-greed-history',
    name: 'Fear & Greed History',
    description: 'Historical Fear & Greed index — 30D / 90D / 1Y line view',
    category: 'YOU',
    component: YouFearGreedHistory,
    props: {},
  },
  'you-ventures': {
    id: 'you-ventures',
    name: 'Ventures',
    description: 'Recent crypto + AI venture funding rounds',
    category: 'YOU',
    component: YouVentures,
    props: {},
  },
  'you-llama-raises': {
    id: 'you-llama-raises',
    name: 'Crypto Raises',
    description: 'On-chain protocol fundraising rounds via DefiLlama',
    category: 'YOU',
    component: YouLlamaRaises,
    props: {},
  },
  'you-accelerators': {
    id: 'you-accelerators',
    name: 'Accelerators',
    description: 'YC + Hub71 cohort companies with one-liners',
    category: 'YOU',
    component: YouAccelerators,
    props: {},
  },
  'you-sec-filings': {
    id: 'you-sec-filings',
    name: 'SEC Filings',
    description: '13F / 13D / 8-K filings from public crypto-adjacent entities',
    category: 'YOU',
    component: YouSecFilings,
    props: {},
  },
  'you-liq-heatmap': {
    id: 'you-liq-heatmap',
    name: 'Liq Heatmap',
    description: 'Top BTC / ETH / SOL liquidation cluster levels above and below price',
    category: 'YOU',
    component: YouLiqHeatmap,
    props: {},
  },
  'you-tradingview-mini': {
    id: 'you-tradingview-mini',
    name: 'Mini Chart',
    description: 'Mini TradingView chart for the selected token',
    category: 'YOU',
    component: YouTradingViewMini,
    props: {},
  },
  'you-unicorns': {
    id: 'you-unicorns',
    name: 'Unicorns',
    description: 'Private market unicorns ranked by valuation, filterable by sector',
    category: 'YOU',
    component: YouUnicorns,
    props: {},
  },
  'you-earnings': {
    id: 'you-earnings',
    name: 'Earnings Calendar',
    description: 'Upcoming US equity earnings with crypto-adjacent tickers highlighted',
    category: 'YOU',
    component: YouEarnings,
    props: {},
  },
  'you-vc-sector-heat': {
    id: 'you-vc-sector-heat',
    name: 'VC Sector Heat',
    description: 'Capital deployed by sector over the last 30D',
    category: 'YOU',
    component: YouVcSectorHeat,
    props: {},
  },
}

export default YOU_REGISTRY

/** Get all unique categories */
export function getYouCategories() {
  const cats = new Set(Object.values(YOU_REGISTRY).map(w => w.category))
  return ['All', ...Array.from(cats)]
}
