import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSEO, SEO_PRESETS } from '../../../lib/useSEO'
import './api-page.css'

/* ══════════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════════ */

const NAV_LINKS = [
  { label: 'Home', href: '/website2' },
  { label: 'API', href: '/website2/api', active: true },
  { label: 'Docs', href: 'https://docs.spectreai.io', external: true },
  { label: 'Status', href: 'https://status.spectreai.io', external: true },
]

const FEATURES = [
  {
    title: 'Market Data',
    desc: '13,000+ assets with live pricing across 760+ categories. Millions of 1-minute candles with 10-second refresh. Fear & Greed index with full historical data and forward returns. Alt season tracking, global market cap, trending assets.',
    accent: '#6B9AE8',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 20h18" strokeLinecap="round" />
        <path d="M5.5 16V10" strokeLinecap="round" strokeWidth="2.5" />
        <path d="M10 16V6" strokeLinecap="round" strokeWidth="2.5" />
        <path d="M14.5 16V12" strokeLinecap="round" strokeWidth="2.5" />
        <path d="M19 16V4" strokeLinecap="round" strokeWidth="2.5" />
      </svg>
    ),
  },
  {
    title: 'Social & Sentiment',
    desc: 'Thousands of tweets ingested per sync across 200+ assets. 780+ KOLs scored by credibility tier. 90+ narratives tracked with rotation momentum. AI sentiment on every post. Bluesky feed, RSS from major outlets. Mindshare scoring with weekly and monthly averages.',
    accent: '#10B981',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
        <line x1="12" y1="1" x2="12" y2="4" strokeLinecap="round" />
        <line x1="12" y1="20" x2="12" y2="23" strokeLinecap="round" />
        <line x1="1" y1="12" x2="4" y2="12" strokeLinecap="round" />
        <line x1="20" y1="12" x2="23" y2="12" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Derivatives Intelligence',
    desc: 'Cross-exchange composite from Binance, OKX, and Bybit covering 260+ assets. Real-time orderbook depth on 45+ pairs. Full Deribit options chain with max pain, IV, and put/call ratio. 220+ Hyperliquid perpetuals. Liquidation heatmaps with cascade risk across multiple leverage tiers.',
    accent: '#F59E0B',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 18l4-6 4 3 4-7 4 4" />
        <path d="M4 18h16" />
        <circle cx="8" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: 'On-Chain Analytics',
    desc: '20+ BTC on-chain metrics including hashrate, mempool, Lightning, and NVT. 10+ ETH metrics covering gas, staking, validators, and burn rate. 890+ assets with holder data. Whale monitoring every 10 minutes. 30 Arkham entity labels. Exchange inflow and outflow tracking.',
    accent: '#EC4899',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <path d="M10 6.5h4" /><path d="M10 17.5h4" />
        <path d="M6.5 10v4" /><path d="M17.5 10v4" />
      </svg>
    ),
  },
  {
    title: 'Research Tools',
    desc: 'Multi-dimensional scoring across 1,900+ assets. Project intelligence covering team, roadmap, GitHub activity, and DAO governance. 30+ tracked fundraising rounds with VC data. 90+ DEX pairs with liquidity. Correlation matrices, ROI calculators, and an economic calendar with 657 events from 9 sources with 4-tier impact classification.',
    accent: '#06B6D4',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" strokeWidth="2" />
        <path d="M8 11h6" /><path d="M11 8v6" />
      </svg>
    ),
  },
  {
    title: 'AI Layer',
    desc: 'LLM-powered per-asset analysis with market-wide breadth and volatility scoring. Liquidation risk assessment across all major pairs. Multiple AI brief types generated daily. Hundreds of enriched asset profiles. Automated project intelligence extraction.',
    accent: '#A78BFA',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M12 3v2" /><path d="M12 19v2" />
        <path d="M5 12H3" /><path d="M21 12h-2" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 8a4 4 0 014 4" strokeWidth="2.5" />
      </svg>
    ),
  },
  {
    title: 'Intelligence Engine',
    desc: '12 signal categories with evidence reinforcement. Hit rate tracking across five time horizons. 7-source convergence scoring combining price, derivatives, social, news, whales, on-chain, and DeFi. Conviction levels from low to very high. Spectre Brain autonomous market conviction engine with live stance and confidence scoring. Full market grounding in a single call.',
    accent: '#F97316',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" />
      </svg>
    ),
  },
  {
    title: 'DeFi & Stablecoins',
    desc: '7,200+ DeFi protocols with TVL, fees, revenue, and volume. 350+ stablecoins tracked with per-chain breakdown. 150+ chains monitored. Bridge volume data. Narrative rotation across 90+ sector themes. Token unlock tracking across dozens of upcoming events.',
    accent: '#14B8A6',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
]

const STATS = [
  { value: 510, suffix: '+', label: 'Endpoints' },
  { value: 13173, suffix: '', label: 'Assets Tracked' },
  { value: 12, suffix: '+', label: 'Data Sources' },
  { value: 10, suffix: 'ms', prefix: '<', label: 'Cached Response' },
  { value: 81, suffix: '', label: 'MCP Tools' },
  { value: 93, suffix: '', label: 'Autonomous Workers' },
  { value: 185, suffix: '', label: 'Database Tables' },
  { value: 25.6, suffix: 'M', label: 'Candle Rows', decimal: true },
]

const CODE_TABS = [
  {
    id: 'typescript',
    label: 'TypeScript',
    content: [
      { type: 'kw', text: 'import' },
      { type: 'plain', text: ' axios ' },
      { type: 'kw', text: 'from' },
      { type: 'str', text: " 'axios'" },
      { type: 'br' },
      { type: 'br' },
      { type: 'kw', text: 'const' },
      { type: 'plain', text: ' spectre = axios.' },
      { type: 'fn', text: 'create' },
      { type: 'plain', text: '({' },
      { type: 'br' },
      { type: 'plain', text: '  ' },
      { type: 'prop', text: 'baseURL' },
      { type: 'plain', text: ': ' },
      { type: 'str', text: "'https://api.spectreai.io/v1'" },
      { type: 'plain', text: ',' },
      { type: 'br' },
      { type: 'plain', text: '  ' },
      { type: 'prop', text: 'headers' },
      { type: 'plain', text: ': { ' },
      { type: 'str', text: "'X-API-Key'" },
      { type: 'plain', text: ': ' },
      { type: 'str', text: "'sk_spectre_...'" },
      { type: 'plain', text: ' }' },
      { type: 'br' },
      { type: 'plain', text: '})' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '// Market grounding - entire context in one call' },
      { type: 'br' },
      { type: 'kw', text: 'const' },
      { type: 'plain', text: ' { ' },
      { type: 'prop', text: 'data' },
      { type: 'plain', text: ': ground } = ' },
      { type: 'kw', text: 'await' },
      { type: 'plain', text: ' spectre.' },
      { type: 'fn', text: 'get' },
      { type: 'plain', text: '(' },
      { type: 'str', text: "'/market/grounding'" },
      { type: 'plain', text: ')' },
      { type: 'br' },
      { type: 'plain', text: 'console.' },
      { type: 'fn', text: 'log' },
      { type: 'plain', text: '(ground.market.fear_greed)' },
      { type: 'br' },
      { type: 'plain', text: 'console.' },
      { type: 'fn', text: 'log' },
      { type: 'plain', text: '(ground.derivatives.btc_oi)' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '// Cross-source convergence' },
      { type: 'br' },
      { type: 'kw', text: 'const' },
      { type: 'plain', text: ' { ' },
      { type: 'prop', text: 'data' },
      { type: 'plain', text: ': conv } = ' },
      { type: 'kw', text: 'await' },
      { type: 'plain', text: ' spectre.' },
      { type: 'fn', text: 'get' },
      { type: 'plain', text: '(' },
      { type: 'str', text: "'/intelligence/convergence/hot'" },
      { type: 'plain', text: ')' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '// Liquidation heatmap' },
      { type: 'br' },
      { type: 'kw', text: 'const' },
      { type: 'plain', text: ' { ' },
      { type: 'prop', text: 'data' },
      { type: 'plain', text: ': liq } = ' },
      { type: 'kw', text: 'await' },
      { type: 'plain', text: ' spectre.' },
      { type: 'fn', text: 'get' },
      { type: 'plain', text: '(' },
      { type: 'str', text: "'/derivatives/liquidation-heatmap/BTC'" },
      { type: 'plain', text: ')' },
      { type: 'br' },
      { type: 'plain', text: 'console.' },
      { type: 'fn', text: 'log' },
      { type: 'plain', text: '(liq.bias)  ' },
      { type: 'cm', text: '// "short_heavy"' },
    ],
  },
  {
    id: 'python',
    label: 'Python',
    content: [
      { type: 'kw', text: 'import' },
      { type: 'plain', text: ' requests' },
      { type: 'br' },
      { type: 'br' },
      { type: 'plain', text: 'API = ' },
      { type: 'str', text: '"https://api.spectreai.io/v1"' },
      { type: 'br' },
      { type: 'plain', text: 'headers = {' },
      { type: 'str', text: '"X-API-Key"' },
      { type: 'plain', text: ': ' },
      { type: 'str', text: '"sk_spectre_..."' },
      { type: 'plain', text: '}' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '# High-conviction signals (reinforced by multiple sources)' },
      { type: 'br' },
      { type: 'plain', text: 'signals = requests.' },
      { type: 'fn', text: 'get' },
      { type: 'plain', text: '(' },
      { type: 'br' },
      { type: 'plain', text: '    f"' },
      { type: 'str', text: '{API}/intelligence/signals/high-conviction' },
      { type: 'plain', text: '",' },
      { type: 'br' },
      { type: 'plain', text: '    ' },
      { type: 'prop', text: 'headers' },
      { type: 'plain', text: '=headers' },
      { type: 'br' },
      { type: 'plain', text: ').' },
      { type: 'fn', text: 'json' },
      { type: 'plain', text: '()' },
      { type: 'br' },
      { type: 'kw', text: 'for' },
      { type: 'plain', text: ' s ' },
      { type: 'kw', text: 'in' },
      { type: 'plain', text: ' signals[' },
      { type: 'str', text: '"data"' },
      { type: 'plain', text: ']:' },
      { type: 'br' },
      { type: 'plain', text: '    ' },
      { type: 'fn', text: 'print' },
      { type: 'plain', text: '(s[' },
      { type: 'str', text: '"asset"' },
      { type: 'plain', text: '], s[' },
      { type: 'str', text: '"conviction"' },
      { type: 'plain', text: '])' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '# Signal accuracy - published receipts' },
      { type: 'br' },
      { type: 'plain', text: 'accuracy = requests.' },
      { type: 'fn', text: 'get' },
      { type: 'plain', text: '(' },
      { type: 'br' },
      { type: 'plain', text: '    f"' },
      { type: 'str', text: '{API}/intelligence/accuracy' },
      { type: 'plain', text: '", ' },
      { type: 'prop', text: 'headers' },
      { type: 'plain', text: '=headers' },
      { type: 'br' },
      { type: 'plain', text: ').' },
      { type: 'fn', text: 'json' },
      { type: 'plain', text: '()' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '# Narrative rotation - what sectors are gaining attention' },
      { type: 'br' },
      { type: 'plain', text: 'narratives = requests.' },
      { type: 'fn', text: 'get' },
      { type: 'plain', text: '(' },
      { type: 'br' },
      { type: 'plain', text: '    f"' },
      { type: 'str', text: '{API}/intelligence/narrative-rotation/rising' },
      { type: 'plain', text: '", ' },
      { type: 'prop', text: 'headers' },
      { type: 'plain', text: '=headers' },
      { type: 'br' },
      { type: 'plain', text: ').' },
      { type: 'fn', text: 'json' },
      { type: 'plain', text: '()' },
    ],
  },
  {
    id: 'curl',
    label: 'curl',
    content: [
      { type: 'cm', text: '# Market grounding - everything in one call' },
      { type: 'br' },
      { type: 'fn', text: 'curl' },
      { type: 'plain', text: ' -H ' },
      { type: 'str', text: '"X-API-Key: sk_spectre_..."' },
      { type: 'plain', text: ' \\' },
      { type: 'br' },
      { type: 'plain', text: '  ' },
      { type: 'str', text: 'https://api.spectreai.io/v1/market/grounding' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '# BTC liquidation cascade' },
      { type: 'br' },
      { type: 'fn', text: 'curl' },
      { type: 'plain', text: ' -H ' },
      { type: 'str', text: '"X-API-Key: sk_spectre_..."' },
      { type: 'plain', text: ' \\' },
      { type: 'br' },
      { type: 'plain', text: '  ' },
      { type: 'str', text: 'https://api.spectreai.io/v1/derivatives/liquidation-heatmap/BTC/cascade-risk' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '# 7-source convergence' },
      { type: 'br' },
      { type: 'fn', text: 'curl' },
      { type: 'plain', text: ' -H ' },
      { type: 'str', text: '"X-API-Key: sk_spectre_..."' },
      { type: 'plain', text: ' \\' },
      { type: 'br' },
      { type: 'plain', text: '  ' },
      { type: 'str', text: 'https://api.spectreai.io/v1/intelligence/convergence/hot' },
      { type: 'br' },
      { type: 'br' },
      { type: 'cm', text: '# Signal accuracy leaderboard' },
      { type: 'br' },
      { type: 'fn', text: 'curl' },
      { type: 'plain', text: ' -H ' },
      { type: 'str', text: '"X-API-Key: sk_spectre_..."' },
      { type: 'plain', text: ' \\' },
      { type: 'br' },
      { type: 'plain', text: '  ' },
      { type: 'str', text: 'https://api.spectreai.io/v1/intelligence/accuracy/leaderboard' },
    ],
  },
]

const PRICING = [
  {
    name: 'Explorer',
    price: 'Free',
    period: '',
    tierDesc: 'Prices, market data, trending, categories. 100 calls/day.',
    features: ['100 calls/day', 'Market data + prices', 'Community support'],
    accent: 'rgba(255,255,255,0.06)',
    accentBorder: 'rgba(255,255,255,0.06)',
    cta: 'Start free',
  },
  {
    name: 'Analyst',
    price: '500',
    period: ' $SPECT',
    tierDesc: 'Everything except AI endpoints. Technicals, derivatives, sentiment, on-chain. 10,000 calls/day.',
    features: ['10,000 calls/day', '+ Derivatives, social, research', 'WebSocket access'],
    accent: 'rgba(107,154,232,0.08)',
    accentBorder: 'rgba(107,154,232,0.15)',
    cta: 'Get $SPECT',
  },
  {
    name: 'Institutional',
    price: '7,000',
    period: ' $SPECT',
    popular: true,
    tierDesc: 'Everything. AI analysis, convergence, hit rates, webhooks. Unlimited.',
    features: ['Unlimited calls', '+ AI layer, on-chain, WebSocket', 'Priority support, SLA'],
    accent: 'rgba(245,245,247,0.06)',
    accentBorder: 'rgba(245,245,247,0.15)',
    cta: 'Get $SPECT',
  },
]

const INTEGRATIONS = [
  {
    title: 'Instant Setup',
    desc: 'API key in 30 seconds. No credit card. Token-gated access.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    title: 'Real-Time WebSocket',
    desc: '7 channels: prices, orderbook, trades, signals, liquidations, briefs, sentiment.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 16l4-8 4 4 4-8" />
      </svg>
    ),
  },
  {
    title: 'Comprehensive Docs',
    desc: '510+ endpoints documented at docs.spectreai.io.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    title: 'MCP for AI Agents',
    desc: '178 tools for Claude, GPT, and any MCP client. The most comprehensive crypto MCP server in production.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9 9h6v6H9z" />
        <path d="M9 1v3" /><path d="M15 1v3" />
        <path d="M9 20v3" /><path d="M15 20v3" />
        <path d="M20 9h3" /><path d="M20 14h3" />
        <path d="M1 9h3" /><path d="M1 14h3" />
      </svg>
    ),
  },
  {
    title: 'x402 Machine Payments',
    desc: 'AI agents pay per-query with USDC on Base. No registration, no API key. Built for the autonomous agent economy.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M16 8h-6a2 2 0 100 4h4a2 2 0 110 4H8" />
        <path d="M12 6v2" /><path d="M12 16v2" />
      </svg>
    ),
  },
]

const DATA_SOURCES = [
  'Binance', 'OKX', 'Bybit', 'CoinGecko', 'DeFiLlama',
  'Deribit', 'Hyperliquid', 'DexScreener', 'Etherscan', 'Coinbase',
  'Kraken', 'Groq AI', 'Bluesky', 'Mempool.space', 'GitHub',
]

const TERMINAL_CMD = '$ curl -H "X-API-Key: sk_spectre_..." \\\n  https://api.spectreai.io/v1/market/grounding'
const TERMINAL_RESPONSE = `{
  "market": {
    "fear_greed": { "value": 14, "classification": "Extreme Fear" },
    "total_market_cap": "2.5T",
    "btc_dominance": "57.2%",
    "alt_season_index": 37
  },
  "prices": {
    "btc": { "price": "$71,001", "change_24h": "-1.07%" },
    "eth": { "price": "$2,182", "change_24h": "-3.28%" }
  },
  "derivatives": {
    "btc_oi": "$245.9B",
    "funding_extremes": 5,
    "options": { "btc_pc_ratio": 0.686, "max_pain": "$70,000" }
  },
  "intelligence": {
    "active_signals": 10,
    "rising_narratives": 5,
    "convergence_alerts": 2,
    "upcoming_catalysts": 5
  }
}`

const FALLBACK_PRICES = {
  bitcoin: { usd: 84250, usd_24h_change: 1.52 },
  ethereum: { usd: 1650, usd_24h_change: -0.34 },
  solana: { usd: 128.5, usd_24h_change: 3.21 },
}

const LIVE_TOKENS = [
  { id: 'bitcoin', symbol: 'BTC' },
  { id: 'ethereum', symbol: 'ETH' },
  { id: 'solana', symbol: 'SOL' },
]

const CONVERGENCE_SOURCES = [
  { label: 'Price', active: true, color: '#6B9AE8' },
  { label: 'Derivatives', active: true, color: '#F59E0B' },
  { label: 'Social', active: false, color: '#EC4899' },
  { label: 'News', active: true, color: '#10B981' },
  { label: 'Whales', active: false, color: '#A78BFA' },
  { label: 'On-chain', active: false, color: '#06B6D4' },
  { label: 'DeFi', active: false, color: '#14B8A6' },
]

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

function formatPrice(n) {
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  return n.toFixed(4)
}

function formatChange(n) {
  const sign = n >= 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/* ══════════════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function ApiPage() {
  useSEO(SEO_PRESETS.api)
  const navigate = useNavigate()
  const [activeCodeTab, setActiveCodeTab] = useState('typescript')
  const [liveData, setLiveData] = useState(FALLBACK_PRICES)
  const [fearGreedData, setFearGreedData] = useState({ value: 14, classification: 'Extreme Fear' })
  const [typedCmd, setTypedCmd] = useState('')
  const [typedResponse, setTypedResponse] = useState('')
  const [terminalPhase, setTerminalPhase] = useState('idle') // idle | cmd | pause | response | done
  const [countersVisible, setCountersVisible] = useState(false)
  const [counterValues, setCounterValues] = useState(STATS.map(() => 0))
  const [isScrolled, setIsScrolled] = useState(false)
  const countersRef = useRef(null)
  const countersTriggered = useRef(false)
  const terminalRef = useRef(null)
  const terminalStarted = useRef(false)

  // Load fonts
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&display=swap'
    document.head.appendChild(link)
    return () => { if (link.parentNode) link.parentNode.removeChild(link) }
  }, [])

  // Always start the API page from the top on navigation. Without this the
  // route can inherit the previous page's scroll position and land at the
  // footer (reported as "API docs opens at the bottom").
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    } catch (_) { console.error(_) }
  }, [])

  // Override root/body overflow for full-page layout
  useEffect(() => {
    const html = document.documentElement
    const root = document.getElementById('root')
    const prev = {
      htmlHeight: html.style.height, htmlOverflow: html.style.overflow,
      rootHeight: root?.style.height, rootOverflow: root?.style.overflow,
      bodyOverflow: document.body.style.overflow,
      bodyOverflowX: document.body.style.overflowX,
      bodyOverflowY: document.body.style.overflowY,
    }
    html.style.height = 'auto'
    html.style.overflow = 'visible'
    if (root) { root.style.height = 'auto'; root.style.overflow = 'visible' }
    document.body.style.overflowX = 'hidden'
    document.body.style.overflowY = 'visible'
    return () => {
      const currentRoot = document.getElementById('root')
      html.style.height = prev.htmlHeight || ''
      html.style.overflow = prev.htmlOverflow || ''
      if (currentRoot) { currentRoot.style.height = prev.rootHeight || ''; currentRoot.style.overflow = prev.rootOverflow || '' }
      document.body.style.overflow = prev.bodyOverflow || ''
      document.body.style.overflowX = prev.bodyOverflowX || ''
      document.body.style.overflowY = prev.bodyOverflowY || ''
    }
  }, [])

  // Scroll listener for nav
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Scroll reveal - IntersectionObserver for .w2-reveal elements
  useEffect(() => {
    let disposed = false
    const io = new IntersectionObserver(
      (entries) => {
        if (disposed) return
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add('w2-visible'); io.unobserve(e.target) }
        })
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    )
    const observeAll = () => {
      if (disposed) return
      document.querySelectorAll('.w2-reveal:not(.w2-visible)').forEach((el) => io.observe(el))
    }
    const rafId = requestAnimationFrame(observeAll)
    const mo = new MutationObserver(observeAll)
    const root = document.querySelector('.ap-page')
    if (root) mo.observe(root, { childList: true, subtree: true })
    return () => { disposed = true; cancelAnimationFrame(rafId); io.disconnect(); mo.disconnect() }
  }, [])

  // Live data fetch from CoinGecko
  useEffect(() => {
    let cancelled = false
    async function fetchPrices() {
      try {
        // 2026-05-28 hide-apis: same-origin /api/coingecko/* -> /api/cg-proxy.
        const res = await fetch(
          '/api/coingecko/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
          { signal: AbortSignal.timeout(8000) }
        )
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setLiveData(data)
      } catch {
        // keep fallback
      }
    }
    fetchPrices()
    const interval = setInterval(() => {
      if (document.hidden) return
      fetchPrices()
    }, 30000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Live F&G fetch — route through our own /api/market/fear-greed proxy
  // (which is server-side and adds the X-API-Key header from env, never
  // shipping the key in the client bundle). Previously this fetched
  // api.spectreai.io directly with a hardcoded 'spectre_dev_internal_key
  // _change_me' literal — that key shipped in dist/assets/*.js for every
  // public visitor to read. Removed 2026-05-12.
  useEffect(() => {
    let cancelled = false
    async function fetchFearGreed() {
      try {
        const res = await fetch('/api/fear-greed/current', {
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.data) {
          setFearGreedData({
            value: data.data.value ?? 14,
            classification: data.data.classification ?? 'Extreme Fear',
          })
        }
      } catch {
        // keep fallback
      }
    }
    fetchFearGreed()
    const interval = setInterval(() => {
      if (document.hidden) return
      fetchFearGreed()
    }, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Terminal typing effect
  useEffect(() => {
    if (terminalStarted.current) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !terminalStarted.current) {
        terminalStarted.current = true
        io.disconnect()
        setTerminalPhase('cmd')
      }
    }, { threshold: 0.3 })
    if (terminalRef.current) io.observe(terminalRef.current)
    return () => io.disconnect()
  }, [])

  // Terminal cmd typing
  useEffect(() => {
    if (terminalPhase !== 'cmd') return
    let i = 0
    const interval = setInterval(() => {
      i++
      setTypedCmd(TERMINAL_CMD.slice(0, i))
      if (i >= TERMINAL_CMD.length) {
        clearInterval(interval)
        setTerminalPhase('pause')
      }
    }, 22)
    return () => clearInterval(interval)
  }, [terminalPhase])

  // Terminal pause then response
  useEffect(() => {
    if (terminalPhase !== 'pause') return
    const timer = setTimeout(() => setTerminalPhase('response'), 600)
    return () => clearTimeout(timer)
  }, [terminalPhase])

  // Terminal response typing
  useEffect(() => {
    if (terminalPhase !== 'response') return
    let i = 0
    const interval = setInterval(() => {
      i++
      setTypedResponse(TERMINAL_RESPONSE.slice(0, i))
      if (i >= TERMINAL_RESPONSE.length) {
        clearInterval(interval)
        setTerminalPhase('done')
      }
    }, 8)
    return () => clearInterval(interval)
  }, [terminalPhase])

  // Counter animation
  useEffect(() => {
    const el = countersRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !countersTriggered.current) {
        countersTriggered.current = true
        setCountersVisible(true)
        io.disconnect()
      }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!countersVisible) return
    const duration = 1500
    const start = performance.now()
    let raf
    function tick(now) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutExpo(progress)
      setCounterValues(STATS.map((s) => {
        if (s.decimal) {
          return Math.round(eased * s.value * 10) / 10
        }
        return Math.round(eased * s.value)
      }))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [countersVisible])

  // Syntax-highlighted response
  const renderTerminalResponse = useCallback(() => {
    if (!typedResponse) return null
    const full = TERMINAL_RESPONSE
    const visible = typedResponse
    const parts = []
    let i = 0
    while (i < visible.length) {
      const keyMatch = full.slice(i).match(/^"([a-z_]+)"(?=\s*:)/)
      if (keyMatch && i + keyMatch[0].length <= visible.length) {
        parts.push(<span key={i} className="ap-json-key">{keyMatch[0]}</span>)
        i += keyMatch[0].length
        continue
      }
      const strMatch = full.slice(i).match(/^"([^"]*)"/)
      if (strMatch && i + strMatch[0].length <= visible.length && full[i - 2] === ':') {
        parts.push(<span key={i} className="ap-json-str">{strMatch[0]}</span>)
        i += strMatch[0].length
        continue
      }
      const numMatch = full.slice(i).match(/^-?\d+\.?\d*/)
      if (numMatch && i + numMatch[0].length <= visible.length) {
        const before = visible.slice(0, i).trimEnd()
        if (before.endsWith(':') || before.endsWith(': ')) {
          parts.push(<span key={i} className="ap-json-num">{numMatch[0]}</span>)
          i += numMatch[0].length
          continue
        }
      }
      parts.push(<span key={i} className="ap-json-punc">{visible[i]}</span>)
      i++
    }
    return parts
  }, [typedResponse])

  const activeTab = CODE_TABS.find((t) => t.id === activeCodeTab)

  return (
    <div className="ap-page">

      {/* ═══════════════════════ NAV ═══════════════════════ */}
      <nav className={`ap-nav${isScrolled ? ' ap-nav--scrolled' : ''}`}>
        <div className="ap-nav-inner">
          <div className="ap-nav-left" onClick={() => navigate('/website2')} style={{ cursor: 'pointer' }}>
            <img src="/spectre-logo-dark.png" alt="Spectre" className="ap-nav-logo" />
            <span className="ap-nav-wordmark">Spectre</span>
          </div>
          <div className="ap-nav-links">
            {NAV_LINKS.map((link) => (
              <button
                key={link.label}
                className={`ap-nav-link${link.active ? ' ap-nav-link--active' : ''}`}
                onClick={() => {
                  if (link.external) {
                    window.open(link.href, '_blank', 'noopener,noreferrer')
                  } else {
                    navigate(link.href)
                  }
                }}
              >
                {link.label}
                {link.active && <span className="ap-nav-dot" />}
              </button>
            ))}
          </div>
          <div className="ap-nav-right">
            <button className="ap-nav-cta" onClick={() => navigate('/website2/api/signup')}>Get API Key</button>
          </div>
        </div>
      </nav>

      {/* ═══════════════════════ SECTION 1: HERO ═══════════════════════ */}
      <section className="ap-hero">
        <video
          className="ap-hero-video"
          src="/images/hero-video.mp4"
          autoPlay
          muted
          loop
          playsInline
        />
        <div className="ap-hero-bg-overlay" />
        <div className="ap-hero-glow" />
        <div className="ap-hero-inner">
          <div className="ap-hero-text">
            <p className="ap-tag w2-reveal">BUILT ON SPECTRE AI</p>
            <h1 className="ap-display w2-reveal w2-stagger-1">
              One API.<br />
              <span className="ap-display-dim">Every Signal.</span>
            </h1>
            <p className="ap-hero-sub w2-reveal w2-stagger-2">
              Pull from the same intelligence layer that powers Spectre. Real-time prices, derivatives, social signals, on-chain data, AI analysis - all through a single endpoint.
            </p>
            <div className="ap-hero-ctas w2-reveal w2-stagger-3">
              <button className="ap-btn-primary" onClick={() => navigate('/website2/api/signup')}>Get API Key</button>
              <a className="ap-btn-ghost" href="https://docs.spectreai.io" target="_blank" rel="noreferrer">View Documentation</a>
            </div>
          </div>
          <div className="ap-terminal w2-reveal w2-stagger-4" ref={terminalRef}>
            <div className="ap-terminal-chrome">
              <span className="ap-terminal-dot ap-terminal-dot--red" />
              <span className="ap-terminal-dot ap-terminal-dot--yellow" />
              <span className="ap-terminal-dot ap-terminal-dot--green" />
              <span className="ap-terminal-title">Terminal</span>
            </div>
            <div className="ap-terminal-body">
              <div className="ap-terminal-line">
                <span className="ap-terminal-prompt">{typedCmd}</span>
                {terminalPhase === 'cmd' && <span className="ap-terminal-cursor" />}
              </div>
              {typedResponse && (
                <pre className="ap-terminal-response">
                  {renderTerminalResponse()}
                  {terminalPhase === 'response' && <span className="ap-terminal-cursor" />}
                </pre>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SECTION 2: LIVE DATA STRIP ═══════════════════════ */}
      <section className="ap-live-strip w2-reveal">
        <div className="ap-live-strip-inner">
          <div className="ap-live-dot" />
          <span className="ap-live-label">LIVE</span>
          {LIVE_TOKENS.map((token) => {
            const d = liveData[token.id]
            if (!d) return null
            const positive = d.usd_24h_change >= 0
            return (
              <div className="ap-live-chip" key={token.id}>
                <span className="ap-live-symbol">{token.symbol}</span>
                <span className="ap-live-price">${formatPrice(d.usd)}</span>
                <span className={`ap-live-change${positive ? ' ap-live-change--up' : ' ap-live-change--down'}`}>
                  {formatChange(d.usd_24h_change)}
                </span>
              </div>
            )
          })}
          <div className="ap-live-divider" />
          <div className="ap-live-chip">
            <span className="ap-live-symbol">F&G</span>
            <span className="ap-live-price">{fearGreedData.value}</span>
            <span className={`ap-live-change${fearGreedData.value >= 50 ? ' ap-live-change--up' : ' ap-live-change--down'}`}>
              {fearGreedData.classification}
            </span>
          </div>
          <div className="ap-live-chip">
            <span className="ap-live-symbol">MCP Tools</span>
            <span className="ap-live-price">81</span>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SECTION 3: FEATURES GRID ═══════════════════════ */}
      <section className="ap-features">
        <div className="ap-section-glow ap-section-glow--blue" />
        <div className="ap-section-header w2-reveal">
          <p className="ap-tag">CAPABILITIES</p>
          <h2 className="ap-display">
            Everything the market<br />
            <span className="ap-display-dim">knows, in one call</span>
          </h2>
        </div>
        <div className="ap-features-grid">
          {FEATURES.map((f, i) => (
            <div
              className={`ap-feature-card w2-reveal w2-stagger-${(i % 4) + 1}`}
              key={f.title}
              style={{ '--feature-accent': f.accent }}
            >
              <div className="ap-feature-icon">{f.icon}</div>
              <h3 className="ap-feature-title">{f.title}</h3>
              <p className="ap-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ SECTION: CINEMATIC DIVIDER ═══════════════════════ */}
      <div className="ap-cinematic-divider w2-reveal">
        <img src="/images/nebula.jpg" alt="" className="ap-cinematic-img" />
        <div className="ap-cinematic-fade ap-cinematic-fade--top" />
        <div className="ap-cinematic-fade ap-cinematic-fade--bottom" />
      </div>

      {/* ═══════════════════════ SECTION 3.5: INTELLIGENCE PROOF ═══════════════════════ */}
      <section className="ap-intelligence-proof">
        <div className="ap-intelligence-proof-bg">
          <img src="/images/network.jpg" alt="" className="ap-intelligence-proof-bg-img" />
          <div className="ap-intelligence-proof-bg-overlay" />
        </div>
        <div className="ap-section-header w2-reveal">
          <p className="ap-tag">INTELLIGENCE</p>
          <h2 className="ap-display">
            Intelligence that<br />
            <span className="ap-display-dim">proves itself</span>
          </h2>
        </div>
        <div className="ap-proof-grid">
          {/* Column 1: Signal Reinforcement */}
          <div className="ap-proof-card w2-reveal w2-stagger-1">
            <div className="ap-proof-card-header">
              <div className="ap-proof-icon-ring" style={{ '--ring-color': '#10B981' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v4" /><path d="M12 18v4" />
                  <path d="M4.93 4.93l2.83 2.83" /><path d="M16.24 16.24l2.83 2.83" />
                  <path d="M2 12h4" /><path d="M18 12h4" />
                </svg>
              </div>
              <h3 className="ap-proof-title">Signal Reinforcement</h3>
            </div>
            <p className="ap-proof-desc">Signals don't fire once and die. They accumulate evidence.</p>
            <div className="ap-proof-timeline">
              <div className="ap-proof-event">
                <span className="ap-proof-time">11:00</span>
                <div className="ap-proof-event-dot" style={{ '--dot-color': '#6B9AE8' }} />
                <span className="ap-proof-event-text">BTC bullish_breakout detected (confidence: 62)</span>
              </div>
              <div className="ap-proof-event">
                <span className="ap-proof-time">11:30</span>
                <div className="ap-proof-event-dot" style={{ '--dot-color': '#A78BFA' }} />
                <span className="ap-proof-event-text">Reinforced by whale_data (+$12M accumulation)</span>
              </div>
              <div className="ap-proof-event">
                <span className="ap-proof-time">12:00</span>
                <div className="ap-proof-event-dot" style={{ '--dot-color': '#F59E0B' }} />
                <span className="ap-proof-event-text">Reinforced by funding_data (rate extreme at 0.08%)</span>
              </div>
              <div className="ap-proof-event">
                <span className="ap-proof-time">12:30</span>
                <div className="ap-proof-event-dot" style={{ '--dot-color': '#10B981' }} />
                <span className="ap-proof-event-text">Reinforced by news_data (3 articles)</span>
              </div>
              <div className="ap-proof-conviction">Conviction: HIGH (4 sources, 6 reinforcements)</div>
            </div>
          </div>

          {/* Column 2: 7-Source Convergence */}
          <div className="ap-proof-card w2-reveal w2-stagger-2">
            <div className="ap-proof-card-header">
              <div className="ap-proof-icon-ring" style={{ '--ring-color': '#6B9AE8' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                </svg>
              </div>
              <h3 className="ap-proof-title">7-Source Convergence</h3>
            </div>
            <p className="ap-proof-desc">When price, derivatives, social, news, whales, on-chain, and DeFi all point the same direction.</p>
            <div className="ap-convergence-visual">
              <div className="ap-convergence-ring">
                {CONVERGENCE_SOURCES.map((src) => (
                  <div
                    className={`ap-convergence-node${src.active ? ' ap-convergence-node--active' : ''}`}
                    key={src.label}
                    style={{ '--node-color': src.color }}
                  >
                    <div className={`ap-convergence-indicator${src.active ? ' ap-convergence-indicator--on' : ''}`} />
                    <span className="ap-convergence-label">{src.label}</span>
                  </div>
                ))}
              </div>
              <div className="ap-convergence-result">
                <span className="ap-convergence-score">3/7</span> sources firing - medium conviction
              </div>
            </div>
          </div>

          {/* Column 3: Published Accuracy */}
          <div className="ap-proof-card w2-reveal w2-stagger-3">
            <div className="ap-proof-card-header">
              <div className="ap-proof-icon-ring" style={{ '--ring-color': '#F97316' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <path d="M22 4L12 14.01l-3-3" />
                </svg>
              </div>
              <h3 className="ap-proof-title">Published Accuracy</h3>
            </div>
            <p className="ap-proof-desc">Every signal gets checked. 1h. 4h. 24h. 48h. 7d.</p>
            <div className="ap-accuracy-table">
              <div className="ap-accuracy-header">
                <span>Signal Type</span>
                <span>Signals</span>
                <span>Hit Rate</span>
                <span>Avg PnL</span>
              </div>
              <div className="ap-accuracy-row">
                <span>bullish_breakout</span>
                <span>17</span>
                <span>--%</span>
                <span>building...</span>
              </div>
              <div className="ap-accuracy-row">
                <span>volume_spike</span>
                <span>187</span>
                <span>--%</span>
                <span>building...</span>
              </div>
            </div>
            <p className="ap-accuracy-note">Accuracy data accumulates over time. First results in 24-48h.</p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SECTION 4: NUMBERS STRIP ═══════════════════════ */}
      <section className="ap-numbers w2-reveal" ref={countersRef}>
        <div className="ap-numbers-inner">
          {STATS.map((s, i) => (
            <div className="ap-number-item" key={s.label}>
              <div className="ap-number-value">
                {s.prefix || ''}{s.decimal ? counterValues[i].toFixed(1) : counterValues[i].toLocaleString()}{s.suffix || ''}
              </div>
              <div className="ap-number-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ SECTION 5: CODE EXAMPLES ═══════════════════════ */}
      <section className="ap-code-section">
        <div className="ap-section-glow ap-section-glow--green" />
        <div className="ap-section-header w2-reveal">
          <p className="ap-tag">DEVELOPERS</p>
          <h2 className="ap-display">
            Three lines<br />
            <span className="ap-display-dim">to market intelligence</span>
          </h2>
        </div>
        <div className="ap-code-block w2-reveal">
          <div className="ap-code-tabs">
            {CODE_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`ap-code-tab${activeCodeTab === tab.id ? ' ap-code-tab--active' : ''}`}
                onClick={() => setActiveCodeTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <pre className="ap-code-content">
            <code>
              {activeTab.content.map((token, i) => {
                if (token.type === 'br') return <br key={i} />
                const cls = token.type === 'plain' ? '' : `ap-${token.type}`
                return <span key={i} className={cls}>{token.text}</span>
              })}
            </code>
          </pre>
        </div>
      </section>

      {/* ═══════════════════════ SECTION 6: PRICING ═══════════════════════ */}
      <section className="ap-pricing">
        <div className="ap-section-glow ap-section-glow--subtle" />
        <div className="ap-section-header w2-reveal">
          <p className="ap-tag">PRICING</p>
          <h2 className="ap-display">
            Scale as<br />
            <span className="ap-display-dim">you grow</span>
          </h2>
        </div>
        <div className="ap-pricing-grid w2-reveal">
          {PRICING.map((plan) => (
            <div
              className={`ap-price-card${plan.popular ? ' ap-price-card--popular' : ''}`}
              key={plan.name}
              style={{
                '--card-accent': plan.accent,
                '--card-accent-border': plan.accentBorder,
              }}
            >
              {plan.popular && <div className="ap-price-badge">MOST POPULAR</div>}
              <div className="ap-price-card-glow" />
              <div className="ap-price-name">{plan.name}</div>
              <div className="ap-price-amount">
                <span className="ap-price-value">{plan.price}</span>
                {plan.period && <span className="ap-price-period">{plan.period}</span>}
              </div>
              {plan.tierDesc && <p className="ap-price-tier-desc">{plan.tierDesc}</p>}
              <ul className="ap-price-features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button className={`ap-price-cta${plan.popular ? ' ap-price-cta--popular' : ''}`}>
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ SECTION 7: INTEGRATION SHOWCASE ═══════════════════════ */}
      <section className="ap-integrations">
        <div className="ap-section-header w2-reveal">
          <p className="ap-tag">INTEGRATE</p>
          <h2 className="ap-display">
            Five ways in.
          </h2>
        </div>
        <div className="ap-integrations-grid w2-reveal">
          {INTEGRATIONS.map((item, i) => (
            <div className={`ap-integration-card w2-reveal w2-stagger-${(i % 5) + 1}`} key={item.title}>
              <div className="ap-integration-icon">{item.icon}</div>
              <h3 className="ap-integration-title">{item.title}</h3>
              <p className="ap-integration-desc">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ SECTION 7.5: BUILT FOR AI AGENTS ═══════════════════════ */}
      <section className="ap-ai-agents">
        <div className="ap-ai-agents-inner w2-reveal">
          <div className="ap-ai-agents-text">
            <p className="ap-tag">AI AGENTS</p>
            <h2 className="ap-ai-agents-heading">81 MCP Tools. One Connection.</h2>
            <p className="ap-ai-agents-desc">
              Any AI agent (Claude, GPT, custom) can query our entire dataset conversationally. Prices, technicals, derivatives, sentiment, signals, narratives, convergence. All through the Model Context Protocol.
            </p>
            <ul className="ap-ai-agents-bullets">
              <li>SSE transport at api.spectreai.io/mcp/sse</li>
              <li>Works with Claude Desktop, Claude Code, any MCP client</li>
              <li>x402 pay-per-query for autonomous agents</li>
            </ul>
          </div>
          <div className="ap-ai-agents-terminal">
            <div className="ap-terminal-chrome">
              <span className="ap-terminal-dot ap-terminal-dot--red" />
              <span className="ap-terminal-dot ap-terminal-dot--yellow" />
              <span className="ap-terminal-dot ap-terminal-dot--green" />
              <span className="ap-terminal-title">MCP Session</span>
            </div>
            <div className="ap-terminal-body ap-mcp-body">
              <div className="ap-mcp-line ap-mcp-line--user">
                <span className="ap-mcp-role">You</span>
                <span className="ap-mcp-text">What's the convergence score for ETH?</span>
              </div>
              <div className="ap-mcp-line ap-mcp-line--agent">
                <span className="ap-mcp-role">Spectre MCP</span>
                <span className="ap-mcp-text">
                  ETH convergence score: 29/100{'\n'}
                  Sources firing: news (238 articles), whales ($56M){'\n'}
                  Conviction: medium{'\n'}
                  Derivatives: funding rate +0.003% (neutral){'\n'}
                  Social: momentum 1.2 (below threshold){'\n'}
                  Recommendation: Watch for derivative confirmation
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SECTION 8: DATA SOURCES ═══════════════════════ */}
      <section className="ap-sources w2-reveal">
        <div className="ap-sources-inner">
          <p className="ap-sources-text">
            We aggregate from <span className="ap-sources-highlight">15 data sources</span>, <span className="ap-sources-highlight">6 exchanges</span>, and our proprietary AI layer - so you don't have to.
          </p>
          <div className="ap-sources-grid">
            {DATA_SOURCES.map((s) => (
              <div className="ap-source-badge" key={s}>{s}</div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ SECTION 9: CTA FOOTER ═══════════════════════ */}
      <section className="ap-cta">
        <div className="ap-cta-bg">
          <img src="/images/depth.jpg" alt="" className="ap-cta-bg-img" />
          <div className="ap-cta-bg-overlay" />
        </div>
        <div className="ap-cta-glow" />
        <div className="ap-cta-inner w2-reveal">
          <h2 className="ap-cta-heading">The entire crypto market in one API call.</h2>
          <p className="ap-cta-sub">
            510 endpoints. 178 MCP tools. 13,173 assets. 93 autonomous workers. Token-gated access.
          </p>
          <div className="ap-cta-buttons">
            <button className="ap-btn-primary ap-cta-btn" onClick={() => window.open('https://docs.spectreai.io', '_blank')}>Get API Key</button>
            <a className="ap-btn-ghost ap-cta-btn-secondary" href="https://docs.spectreai.io" target="_blank" rel="noreferrer">View Documentation</a>
            <a className="ap-cta-ghost-link" href="https://docs.spectreai.io/mcp" target="_blank" rel="noreferrer">Connect MCP</a>
          </div>
          <div className="ap-cta-links">
            <a href="https://docs.spectreai.io" target="_blank" rel="noreferrer" className="ap-cta-link">Docs</a>
            <span className="ap-cta-sep" />
            <a href="https://status.spectreai.io" target="_blank" rel="noreferrer" className="ap-cta-link">Status</a>
            <span className="ap-cta-sep" />
            <a href="https://dash.spectreai.io" target="_blank" rel="noreferrer" className="ap-cta-link">Dashboard</a>
            <span className="ap-cta-sep" />
            <a href="https://telegram.me/AI_SPECTRE" target="_blank" rel="noreferrer" className="ap-cta-link">Telegram</a>
            <span className="ap-cta-sep" />
            <a href="https://discord.gg/spectre" target="_blank" rel="noreferrer" className="ap-cta-link">Discord</a>
          </div>
        </div>
      </section>

    </div>
  )
}
