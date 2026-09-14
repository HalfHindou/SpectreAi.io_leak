/**
 * Per-route SEO metadata catalog.
 *
 * Each entry produces a unique <title>, <meta description>, and canonical URL
 * for a given route. Used by RouteMeta.jsx to feed react-helmet-async.
 *
 * Keep titles < 60 chars and descriptions 140-160 chars for best SERP display.
 */

const SITE_NAME = 'Spectre AI'
const SITE_URL = 'https://spectreai.io'
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`

const brandSuffix = (t) => `${t} | ${SITE_NAME}`

// Static exact-path routes
export const STATIC_ROUTE_META = {
  '/arena': {
    title: brandSuffix('Agent Arena - AI Trading Strategies, Graded Live'),
    description: 'Every Spectre paper-trading strategy on one public scoreboard: real equity curves, win rates, drawdowns, and every close reason. The losing books stay visible.',
  },
  '/cinema': {
    title: brandSuffix('Market Cinema - Live Liquidations and Whale Flows'),
    description: 'A full-screen ambient market stage. Live liquidation prints rendered as they land, labeled whale and stablecoin transfers, and the current market regime.',
  },
  '/vitals': {
    title: brandSuffix('Vitals - Platform Fundamentals, Revenue and Real Users'),
    description: 'Revenue, fees, users, volume and TVL for every crypto platform we can measure - including per-app daily active traders and net trader PnL that Spectre counts first-hand from raw fills.',
  },
  '/world-state': {
    title: brandSuffix('World State - Macro and Policy, Versioned Live'),
    description: 'The macro-politics document behind Spectre: Fed odds, net liquidity tide, CME Bitcoin positioning, policy stances with quotes, and what just changed.',
  },
  '/': {
    title: brandSuffix('Crypto Market Intelligence Platform'),
    description: 'Real-time crypto intelligence for 10,000+ tokens. AI analysis, on-chain data, social sentiment, Fear & Greed Index, liquidation heatmaps, and non-custodial trading in one dashboard.',
  },
  '/website2': {
    title: brandSuffix('AI Market Intelligence. One Screen. Every Signal'),
    description: '50,000+ assets. 500+ sources. Every chart, post, and wallet read live, then written back to you in one sentence you can act on. Backed by Google for Startups and NVIDIA Inception.',
  },
  '/website2/api': {
    title: brandSuffix('Crypto API - 510+ Endpoints, MCP Server, x402 Micropayments'),
    description: '510+ REST endpoints, 7 WebSocket channels, 178 MCP tools for Claude and ChatGPT, and x402 pay-per-request access. The entire crypto market in one API call.',
  },
  '/fear-greed': {
    title: brandSuffix('Crypto Fear and Greed Index - Live Market Sentiment'),
    description: 'Real-time crypto Fear and Greed Index aggregating volatility, volume, social sentiment, dominance, and on-chain signals into a 0-100 reading of market psychology.',
  },
  '/liquidation-heatmap': {
    title: brandSuffix('Crypto Liquidation Heatmap - Cascade Risk Live'),
    description: 'Live liquidation heatmap across Binance, OKX, Bybit, Deribit, and Hyperliquid. See liquidation levels, cascade risk, and funding rates in real time.',
  },
  '/economic-calendar': {
    title: brandSuffix('Crypto and Macro Economic Calendar - 657+ Events'),
    description: '657+ macro and crypto events from 9 sources with 4-tier impact filtering. FOMC, CPI, NFP, central bank decisions, token unlocks, and IPO dates.',
  },
  '/heatmaps': {
    title: brandSuffix('Crypto Market Heatmap - 24h Performance by Sector'),
    description: '24-hour crypto market performance heatmap by sector and market cap. Spot sector rotation, breakouts, and breakdowns at a glance.',
  },
  '/bubbles': {
    title: brandSuffix('Crypto Bubbles - Market Cap vs Price Change'),
    description: 'Interactive crypto bubble chart visualizing market cap against price change for the top tokens. Spot momentum and outliers instantly.',
  },
  '/intelligence': {
    title: brandSuffix('Intelligence Hub - AI-Curated Crypto Research'),
    description: 'Daily AI-curated crypto research, hero stories, deep analysis, and breaking news. Synthesizes 500+ sources into actionable intelligence.',
  },
  '/news': {
    title: brandSuffix('Crypto News Engine - Multi-Source with AI Sentiment'),
    description: 'Aggregated crypto news from 500+ sources with AI classification, sentiment scoring, and market impact filtering. Stay ahead of every narrative.',
  },
  '/x-intelligence': {
    title: brandSuffix('X/Twitter Crypto Intelligence - Influence Graph'),
    description: 'Real-time X/Twitter crypto intelligence. 780+ tracked KOLs, 90+ narratives, influence graph, and sentiment per asset.',
  },
  '/traders-corner': {
    title: brandSuffix('Traders Corner - CVD, OI, Liquidations, Funding'),
    description: 'Professional derivatives intelligence: CVD, order book depth, liquidation bars, funding rates, and open interest across Binance, OKX, Bybit, Deribit.',
  },
  '/monarch-chat': {
    title: brandSuffix('Monarch AI - Conversational Crypto Analyst'),
    description: 'Chat with Monarch, Spectre\'s conversational AI analyst. Ask any question about tokens, sectors, on-chain flows, or market events and get live data-backed answers.',
  },
  '/predictions': {
    title: brandSuffix('Crypto Prediction Markets - Polymarket Integration'),
    description: 'Live prediction market odds powered by Polymarket. Track political, macro, crypto, and sports outcomes with real money-weighted probabilities.',
  },
  '/tokenized-assets': {
    title: brandSuffix('Tokenized Real World Assets - RWA Tracker'),
    description: 'Track tokenized real-world assets: US Treasuries, private credit, real estate, and commodities on-chain. TVL, issuance, and yield data.',
  },
  '/ventures': {
    title: brandSuffix('Crypto Ventures - Early-Stage Project Tracking'),
    description: 'Track early-stage crypto projects, funding rounds, and VC deal flow. Surface seed-to-series-A opportunities before they hit mainstream radar.',
  },
  '/discover': {
    title: brandSuffix('Discover Trending Crypto Tokens'),
    description: 'Discover trending tokens, new listings, and curated crypto opportunities. AI-ranked by momentum, volume, and social velocity.',
  },
  '/ai-charts': {
    title: brandSuffix('AI Charts - Pattern Recognition and Technical Analysis'),
    description: 'AI-powered technical analysis with automatic pattern recognition, support and resistance detection, and trend classification across 10,000+ tokens.',
  },
  '/search-engine': {
    title: brandSuffix('Crypto Search Engine - 50,000+ Tokens'),
    description: 'Semantic search across 50,000+ crypto tokens with AI ranking. Find tokens by name, symbol, contract, theme, or narrative.',
  },
  '/search': {
    title: brandSuffix('Crypto Search Engine - 50,000+ Tokens'),
    description: 'Semantic search across 50,000+ crypto tokens with AI ranking. Find tokens by name, symbol, contract, theme, or narrative.',
  },
  '/insights': {
    title: brandSuffix('Intel Desk - Every Signal, Kept'),
    description: 'The Spectre intelligence feed as a working record: breaking, macro, on-chain runners, desk calls and risk — laned, searchable, and linkable.',
  },
  '/intelligence-feed': {
    title: brandSuffix('Intel Desk - Every Signal, Kept'),
    description: 'The Spectre intelligence feed as a working record: breaking, macro, on-chain runners, desk calls and risk — laned, searchable, and linkable.',
  },
  '/facts': {
    title: 'Spectre AI - Facts, Press Kit, and Company Information',
    description: 'Canonical facts about Spectre AI: crypto market intelligence platform covering 10,000+ tokens, 510+ API endpoints, 178 MCP tools, backed by Google for Startups and NVIDIA Inception.',
  },
}

// Dynamic route patterns (order matters - more specific first)
// Each pattern: { test(pathname) -> boolean, meta(pathname, params) -> {title, description, ogImage} }
export const DYNAMIC_ROUTE_PATTERNS = [
  {
    name: 'research-zone-slug',
    match: /^\/research-zone\/([^/?#]+)$/,
    build: (m) => {
      const slug = decodeURIComponent(m[1] || '').trim()
      const display = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Token'
      return {
        title: brandSuffix(`${display} Research - Price, Charts, On-Chain, Sentiment`),
        description: `Deep-dive ${display} research. Live price, charts, holder distribution, whale activity, social sentiment, and AI analysis. Powered by Spectre AI.`,
      }
    },
  },
  {
    name: 'research-zone-root',
    match: /^\/research-zone\/?$/,
    build: () => ({
      title: brandSuffix('Research Zone - Deep Crypto Token Analysis'),
      description: 'Deep-dive token research with on-chain metrics, whale tracking, social sentiment, and AI-generated insights for every major crypto asset.',
    }),
  },
  {
    name: 'intelligence-article',
    match: /^\/intelligence\/([^/]+)\/([^/?#]+)$/,
    build: (m) => {
      const slug = decodeURIComponent(m[2] || '').replace(/-/g, ' ').trim()
      const display = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Article'
      return {
        title: brandSuffix(display),
        description: `${display} - AI-curated crypto research and analysis from the Spectre Intelligence Hub.`,
      }
    },
  },
  {
    name: 'news-article',
    match: /^\/news\/([^/?#]+)$/,
    build: (m) => {
      const slug = decodeURIComponent(m[1] || '').replace(/-/g, ' ').trim()
      const display = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Article'
      return {
        title: brandSuffix(display),
        description: `${display} - Breaking crypto news aggregated and AI-classified by Spectre AI.`,
      }
    },
  },
  {
    name: 'vs-competitor',
    match: /^\/vs\/([^/?#]+)$/,
    build: (m) => {
      const slug = decodeURIComponent(m[1] || '').trim()
      const display = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Competitor'
      return {
        title: brandSuffix(`Spectre AI vs ${display} - Honest Comparison`),
        description: `Honest comparison of Spectre AI and ${display}. Capabilities, strengths, tradeoffs, and when to pick each.`,
      }
    },
  },
  {
    name: 'how-to-guide',
    match: /^\/how-to\/([^/?#]+)$/,
    build: (m) => {
      const slug = decodeURIComponent(m[1] || '').replace(/-/g, ' ').trim()
      const display = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Guide'
      return {
        title: brandSuffix(`How to ${display}`),
        description: `Step-by-step guide for ${display}. Concise, imperative instructions from Spectre AI.`,
      }
    },
  },
  {
    name: 'predictions-event',
    match: /^\/predictions\/([^/?#]+)$/,
    build: (m) => {
      const slug = decodeURIComponent(m[1] || '').replace(/-/g, ' ').trim()
      const display = slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Market'
      return {
        title: brandSuffix(`${display} - Prediction Market Odds`),
        description: `Live prediction market odds for "${display}" powered by Polymarket. See real money-weighted probabilities.`,
      }
    },
  },
]

// Fallback for any unmapped route - better than reusing homepage meta
export const DEFAULT_META = {
  title: `${SITE_NAME} - Crypto Market Intelligence`,
  description: 'Real-time crypto market intelligence with AI analysis, on-chain data, social sentiment, and non-custodial trading tools.',
}

export function resolveMeta(pathname) {
  // Exact static match first
  if (STATIC_ROUTE_META[pathname]) {
    return { ...STATIC_ROUTE_META[pathname], canonical: `${SITE_URL}${pathname}` }
  }
  // Dynamic pattern match
  for (const pattern of DYNAMIC_ROUTE_PATTERNS) {
    const m = pathname.match(pattern.match)
    if (m) return { ...pattern.build(m), canonical: `${SITE_URL}${pathname}` }
  }
  // Fallback
  return { ...DEFAULT_META, canonical: `${SITE_URL}${pathname}` }
}

export { SITE_NAME, SITE_URL, DEFAULT_OG_IMAGE }
