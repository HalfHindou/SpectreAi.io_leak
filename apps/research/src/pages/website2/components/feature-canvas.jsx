import { useState, useEffect, useCallback, useRef } from 'react'
import './feature-canvas.css'

/* ══════════════════════════════════════════════════════════════
   PILLAR ICONS - Bespoke vector art for each category thumbnail
   ══════════════════════════════════════════════════════════════ */

function IconMain({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {/* Dashboard panels layout */}
      <rect x="14" y="16" width="56" height="34" rx="6" fill={color} opacity="0.18" />
      <rect x="14" y="16" width="56" height="34" rx="6" stroke={color} strokeWidth="1" opacity="0.3" />
      <rect x="16" y="22" width="28" height="3" rx="1.5" fill={color} opacity="0.5" />
      <rect x="16" y="28" width="18" height="2" rx="1" fill={color} opacity="0.2" />
      <rect x="16" y="33" width="50" height="12" rx="3" fill={color} opacity="0.08" />
      <rect x="20" y="37" width="22" height="2" rx="1" fill={color} opacity="0.25" />
      <rect x="20" y="41" width="14" height="2" rx="1" fill={color} opacity="0.15" />
      {/* Right tall card */}
      <rect x="76" y="16" width="30" height="52" rx="6" fill={color} opacity="0.1" />
      <rect x="76" y="16" width="30" height="52" rx="6" stroke={color} strokeWidth="1" opacity="0.2" />
      <circle cx="91" cy="32" r="8" fill={color} opacity="0.12" />
      <rect x="82" y="44" width="18" height="2" rx="1" fill={color} opacity="0.25" />
      <rect x="85" y="49" width="12" height="2" rx="1" fill={color} opacity="0.15" />
      <rect x="82" y="56" width="18" height="6" rx="3" fill={color} opacity="0.18" />
      {/* Bottom wide card */}
      <rect x="14" y="56" width="56" height="34" rx="6" fill={color} opacity="0.1" />
      <rect x="14" y="56" width="56" height="34" rx="6" stroke={color} strokeWidth="1" opacity="0.2" />
      {/* Sparkline */}
      <polyline points="20,78 30,72 38,76 46,68 54,74 62,66" stroke={color} strokeWidth="1.5" opacity="0.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="20" y="62" width="24" height="2.5" rx="1.25" fill={color} opacity="0.3" />
      {/* Bottom right square */}
      <rect x="76" y="74" width="30" height="16" rx="6" fill={color} opacity="0.14" />
      <rect x="76" y="74" width="30" height="16" rx="6" stroke={color} strokeWidth="1" opacity="0.2" />
      <rect x="82" y="80" width="18" height="2" rx="1" fill={color} opacity="0.3" />
      <rect x="82" y="85" width="10" height="2" rx="1" fill={color} opacity="0.15" />
      {/* Live pulse dot */}
      <circle cx="102" cy="20" r="3" fill={color} opacity="0.7" />
      <circle cx="102" cy="20" r="6" fill={color} opacity="0.15" />
    </svg>
  )
}

function IconResearch({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {/* Stacked editorial cards - newspaper feel */}
      <rect x="10" y="28" width="100" height="70" rx="8" fill={color} fillOpacity="0.06" stroke={color} strokeWidth="0.7" strokeOpacity="0.12" />
      <rect x="16" y="22" width="88" height="70" rx="8" fill={color} fillOpacity="0.08" stroke={color} strokeWidth="0.7" strokeOpacity="0.15" />
      {/* Top card - the "article" */}
      <rect x="22" y="16" width="76" height="70" rx="8" fill={color} fillOpacity="0.14" stroke={color} strokeWidth="1" strokeOpacity="0.3" />
      {/* Headline */}
      <rect x="30" y="26" width="40" height="4" rx="2" fill={color} opacity="0.6" />
      <rect x="30" y="34" width="60" height="2.5" rx="1.25" fill={color} opacity="0.25" />
      <rect x="30" y="40" width="52" height="2.5" rx="1.25" fill={color} opacity="0.18" />
      {/* Divider */}
      <line x1="30" y1="48" x2="90" y2="48" stroke={color} strokeWidth="0.5" opacity="0.15" />
      {/* Two column text below */}
      <rect x="30" y="53" width="26" height="2" rx="1" fill={color} opacity="0.2" />
      <rect x="30" y="58" width="26" height="2" rx="1" fill={color} opacity="0.15" />
      <rect x="30" y="63" width="20" height="2" rx="1" fill={color} opacity="0.12" />
      <rect x="62" y="53" width="26" height="2" rx="1" fill={color} opacity="0.2" />
      <rect x="62" y="58" width="26" height="2" rx="1" fill={color} opacity="0.15" />
      <rect x="62" y="63" width="18" height="2" rx="1" fill={color} opacity="0.12" />
      {/* Sentiment badge */}
      <rect x="30" y="72" width="22" height="6" rx="3" fill={color} opacity="0.22" />
      <rect x="56" y="72" width="16" height="6" rx="3" fill={color} opacity="0.12" />
      {/* Magnifying glass accent */}
      <circle cx="90" cy="28" r="7" stroke={color} strokeWidth="1.5" opacity="0.35" fill="none" />
      <line x1="95" y1="33" x2="100" y2="38" stroke={color} strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />
    </svg>
  )
}

function IconTrading({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {/* Candlestick chart */}
      {/* Wicks */}
      <line x1="24" y1="28" x2="24" y2="82" stroke={color} strokeWidth="1" opacity="0.2" />
      <line x1="42" y1="22" x2="42" y2="76" stroke={color} strokeWidth="1" opacity="0.2" />
      <line x1="60" y1="32" x2="60" y2="90" stroke={color} strokeWidth="1" opacity="0.2" />
      <line x1="78" y1="18" x2="78" y2="72" stroke={color} strokeWidth="1" opacity="0.2" />
      <line x1="96" y1="24" x2="96" y2="68" stroke={color} strokeWidth="1" opacity="0.2" />
      {/* Candle bodies */}
      <rect x="18" y="40" width="12" height="28" rx="2" fill={color} opacity="0.45" />
      <rect x="36" y="34" width="12" height="22" rx="2" fill="rgba(239,68,68,0.35)" />
      <rect x="54" y="46" width="12" height="30" rx="2" fill={color} opacity="0.5" />
      <rect x="72" y="30" width="12" height="24" rx="2" fill={color} opacity="0.55" />
      <rect x="90" y="36" width="12" height="18" rx="2" fill="rgba(239,68,68,0.3)" />
      {/* Trend line overlay */}
      <polyline points="24,55 42,44 60,60 78,38 96,42" stroke={color} strokeWidth="1.5" opacity="0.5" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="3,3" />
      {/* Price label */}
      <rect x="68" y="92" width="42" height="12" rx="4" fill={color} opacity="0.12" />
      <rect x="74" y="96" width="24" height="3" rx="1.5" fill={color} opacity="0.35" />
    </svg>
  )
}

function IconAnalysis({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {/* Calendar grid meets analytics */}
      <rect x="14" y="20" width="92" height="76" rx="8" stroke={color} strokeWidth="1" opacity="0.25" fill={color} fillOpacity="0.06" />
      {/* Header bar */}
      <rect x="14" y="20" width="92" height="16" rx="8" fill={color} opacity="0.15" />
      <rect x="14" y="28" width="92" height="8" fill={color} opacity="0.15" />
      <rect x="22" y="24" width="24" height="3" rx="1.5" fill={color} opacity="0.5" />
      {/* Grid lines */}
      <line x1="37" y1="36" x2="37" y2="96" stroke={color} strokeWidth="0.5" opacity="0.08" />
      <line x1="60" y1="36" x2="60" y2="96" stroke={color} strokeWidth="0.5" opacity="0.08" />
      <line x1="83" y1="36" x2="83" y2="96" stroke={color} strokeWidth="0.5" opacity="0.08" />
      <line x1="14" y1="56" x2="106" y2="56" stroke={color} strokeWidth="0.5" opacity="0.08" />
      <line x1="14" y1="76" x2="106" y2="76" stroke={color} strokeWidth="0.5" opacity="0.08" />
      {/* Calendar dots - events */}
      <circle cx="25" cy="46" r="3" fill={color} opacity="0.4" />
      <circle cx="48" cy="46" r="3" fill={color} opacity="0.2" />
      <circle cx="71" cy="66" r="4" fill={color} opacity="0.5" />
      <circle cx="94" cy="46" r="2.5" fill={color} opacity="0.15" />
      <circle cx="25" cy="66" r="2.5" fill={color} opacity="0.12" />
      <circle cx="48" cy="86" r="3.5" fill={color} opacity="0.35" />
      <circle cx="94" cy="86" r="3" fill={color} opacity="0.25" />
      {/* Trend arrow */}
      <polyline points="18,88 40,78 62,82 84,62 100,50" stroke={color} strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points="92,50 100,50 100,58" stroke={color} strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

const HEAT_DATA = [
  [0.5, 0.3, 0.15, 0.4, 0.2, 0.35, 0.1],
  [0.2, 0.45, 0.6, 0.3, 0.5, 0.15, 0.25],
  [0.1, 0.3, 0.7, 0.55, 0.4, 0.2, 0.3],
  [0.35, 0.2, 0.5, 0.8, 0.6, 0.45, 0.15],
  [0.15, 0.4, 0.35, 0.6, 0.5, 0.3, 0.2],
  [0.3, 0.1, 0.25, 0.4, 0.35, 0.55, 0.4],
  [0.1, 0.2, 0.15, 0.2, 0.25, 0.3, 0.15],
]
const HEAT_CELLS = HEAT_DATA.flatMap((row, r) =>
  row.map((o, c) => ({ key: `h${r}${c}`, x: 16 + c * 13.5, y: 16 + r * 13.5, o, green: o > 0.3 }))
)

function IconVisualize({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {HEAT_CELLS.map(c => (
        <rect
          key={c.key}
          x={c.x} y={c.y}
          width="12" height="12" rx="2.5"
          fill={c.green ? color : 'rgba(239,68,68,0.7)'}
          opacity={c.o}
        />
      ))}
    </svg>
  )
}

function IconSocial({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {/* Social network graph */}
      {/* Connection lines first (behind nodes) */}
      <line x1="60" y1="40" x2="32" y2="62" stroke={color} strokeWidth="1" opacity="0.2" />
      <line x1="60" y1="40" x2="88" y2="58" stroke={color} strokeWidth="1" opacity="0.2" />
      <line x1="60" y1="40" x2="60" y2="18" stroke={color} strokeWidth="1" opacity="0.15" />
      <line x1="60" y1="40" x2="42" y2="28" stroke={color} strokeWidth="1" opacity="0.15" />
      <line x1="60" y1="40" x2="82" y2="30" stroke={color} strokeWidth="1" opacity="0.15" />
      <line x1="32" y1="62" x2="22" y2="84" stroke={color} strokeWidth="0.8" opacity="0.12" />
      <line x1="32" y1="62" x2="50" y2="80" stroke={color} strokeWidth="0.8" opacity="0.12" />
      <line x1="88" y1="58" x2="98" y2="78" stroke={color} strokeWidth="0.8" opacity="0.12" />
      <line x1="88" y1="58" x2="72" y2="76" stroke={color} strokeWidth="0.8" opacity="0.12" />
      {/* Central node */}
      <circle cx="60" cy="40" r="10" fill={color} opacity="0.35" />
      <circle cx="60" cy="40" r="10" stroke={color} strokeWidth="1.2" opacity="0.5" fill="none" />
      {/* Tier 2 nodes */}
      <circle cx="32" cy="62" r="7" fill={color} opacity="0.25" />
      <circle cx="32" cy="62" r="7" stroke={color} strokeWidth="0.8" opacity="0.35" fill="none" />
      <circle cx="88" cy="58" r="7" fill={color} opacity="0.25" />
      <circle cx="88" cy="58" r="7" stroke={color} strokeWidth="0.8" opacity="0.35" fill="none" />
      {/* Tier 1 nodes */}
      <circle cx="60" cy="18" r="4" fill={color} opacity="0.2" />
      <circle cx="42" cy="28" r="3.5" fill={color} opacity="0.18" />
      <circle cx="82" cy="30" r="4.5" fill={color} opacity="0.2" />
      {/* Tier 3 leaf nodes */}
      <circle cx="22" cy="84" r="4" fill={color} opacity="0.15" />
      <circle cx="50" cy="80" r="3" fill={color} opacity="0.12" />
      <circle cx="98" cy="78" r="4.5" fill={color} opacity="0.15" />
      <circle cx="72" cy="76" r="3" fill={color} opacity="0.12" />
      {/* Pulse rings */}
      <circle cx="60" cy="40" r="18" stroke={color} strokeWidth="0.5" opacity="0.1" fill="none" />
      <circle cx="60" cy="40" r="30" stroke={color} strokeWidth="0.5" opacity="0.06" fill="none" />
    </svg>
  )
}

function IconTools({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {/* Watchlist / list view */}
      <rect x="18" y="16" width="84" height="88" rx="8" stroke={color} strokeWidth="1" opacity="0.2" fill={color} fillOpacity="0.04" />
      {/* Header */}
      <rect x="18" y="16" width="84" height="14" rx="8" fill={color} opacity="0.12" />
      <rect x="18" y="22" width="84" height="8" fill={color} opacity="0.12" />
      <rect x="26" y="20" width="20" height="3" rx="1.5" fill={color} opacity="0.4" />
      {/* Rows */}
      {[0,1,2,3,4].map(i => {
        const y = 38 + i * 14
        return (
          <g key={i} opacity={1 - i * 0.12}>
            <circle cx="28" cy={y + 3} r="4" fill={color} opacity={0.25 - i * 0.03} />
            <rect x="36" y={y} width={24 - i * 2} height="3" rx="1.5" fill={color} opacity={0.3 - i * 0.03} />
            <rect x="36" y={y + 5} width={14} height="2" rx="1" fill={color} opacity={0.12} />
            {/* Price right-aligned */}
            <rect x="76" y={y} width="18" height="3" rx="1.5" fill={color} opacity={0.2} />
            {/* Sparkline mini */}
            <polyline
              points={`76,${y+6} 80,${y+4} 84,${y+7} 88,${y+3} 94,${y+5}`}
              stroke={i % 2 === 0 ? color : 'rgba(239,68,68,0.4)'}
              strokeWidth="1"
              opacity="0.3"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        )
      })}
      {/* Star icon */}
      <polygon points="92,20 93.5,23 97,23.5 94.5,25.8 95,29.3 92,27.5 89,29.3 89.5,25.8 87,23.5 90.5,23" fill={color} opacity="0.35" />
    </svg>
  )
}

function IconMarketplace({ color }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="fc-icon">
      {/* API / Code brackets with plug feel */}
      {/* Left bracket */}
      <path d="M38 32 L26 60 L38 88" stroke={color} strokeWidth="2.5" opacity="0.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Right bracket */}
      <path d="M82 32 L94 60 L82 88" stroke={color} strokeWidth="2.5" opacity="0.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Slash */}
      <line x1="66" y1="28" x2="54" y2="92" stroke={color} strokeWidth="1.5" opacity="0.2" />
      {/* Code lines */}
      <rect x="46" y="48" width="14" height="3" rx="1.5" fill={color} opacity="0.35" />
      <rect x="63" y="48" width="8" height="3" rx="1.5" fill={color} opacity="0.2" />
      <rect x="42" y="56" width="10" height="3" rx="1.5" fill={color} opacity="0.2" />
      <rect x="55" y="56" width="20" height="3" rx="1.5" fill={color} opacity="0.3" />
      <rect x="48" y="64" width="24" height="3" rx="1.5" fill={color} opacity="0.15" />
      {/* Connection dots */}
      <circle cx="60" cy="18" r="3" fill={color} opacity="0.25" />
      <circle cx="60" cy="102" r="3" fill={color} opacity="0.25" />
      <line x1="60" y1="21" x2="60" y2="28" stroke={color} strokeWidth="1" opacity="0.15" />
      <line x1="60" y1="92" x2="60" y2="99" stroke={color} strokeWidth="1" opacity="0.15" />
      {/* "SOON" corner badge feel */}
      <rect x="70" y="80" width="28" height="10" rx="5" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="0.7" strokeOpacity="0.2" />
      <rect x="76" y="83.5" width="16" height="3" rx="1.5" fill={color} opacity="0.3" />
    </svg>
  )
}

const PILLAR_ICONS = {
  main: IconMain,
  research: IconResearch,
  trading: IconTrading,
  analysis: IconAnalysis,
  visualize: IconVisualize,
  social: IconSocial,
  tools: IconTools,
  marketplace: IconMarketplace,
}

/* ══════════════════════════════════════════════════════════════
   PILLAR DATA - 8 pillars matching the left nav categories
   Each slide maps a `ui` key to a screenshot in /public/slides/
   ══════════════════════════════════════════════════════════════ */

const PILLARS = [
  {
    id: 'main',
    label: 'Main',
    sublabel: '5 features',
    color: '#6B9AE8',
    pos: { top: '4%', left: '15%' },
    thumb: 'brief',
    slides: [
      { name: 'Research Platform', desc: 'Full-featured command center with AI briefs, Spectre Brain conviction, watchlists, and live market stats', url: 'spectreai.io', badge: 'LIVE', ui: 'brief' },
      { name: 'Monarch AI', desc: 'Conversational AI analyst with real-time market data integration', url: 'spectreai.io/monarch-chat', badge: 'LIVE', ui: 'chat' },
      { name: 'GM Dashboard', desc: 'Full-screen morning dashboard with overnight market summary', url: 'spectreai.io/gm-dashboard', badge: 'LIVE', ui: 'gm' },
      { name: 'Discover', desc: 'Trending tokens, new listings, and curated discovery feeds', url: 'spectreai.io/discover', badge: 'LIVE', ui: 'discover' },
      { name: 'YOU Dashboard', desc: '36+ configurable widgets - drag, drop, resize, personalize', url: 'spectreai.io/you', badge: 'LIVE', ui: 'widgets' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    sublabel: '7 features',
    color: '#EC4899',
    pos: { top: '8%', left: '42%' },
    thumb: 'intel',
    slides: [
      { name: 'Intelligence Hub', desc: 'Editorial publication with hero stories, analysis columns, and breaking news', url: 'spectreai.io/intelligence', badge: 'LIVE', ui: 'intel' },
      { name: 'Intelligence Feed', desc: 'Curated real-time feed of market-moving intelligence and signals', url: 'spectreai.io/intelligence-feed', badge: 'LIVE', ui: 'feed' },
      { name: 'News Engine', desc: 'Multi-source news aggregation with sentiment scoring and filtering', url: 'spectreai.io/news', badge: 'LIVE', ui: 'newsroom' },
      { name: 'Research Zone', desc: 'Deep token analysis with on-chain metrics and AI synthesis', url: 'spectreai.io/research-zone', badge: 'LIVE', ui: 'research' },
      { name: 'Search Engine', desc: 'Semantic search across 50,000+ tokens with AI ranking', url: 'spectreai.io/search-engine', badge: 'LIVE', ui: 'search' },
      { name: 'Ventures', desc: 'Early-stage project tracking and venture capital deal flow', url: 'spectreai.io/ventures', badge: 'LIVE', ui: 'ventures' },
      { name: 'Tokenized Assets', desc: 'Real-world asset tokenization tracking and opportunities', url: 'spectreai.io/tokenized-assets', badge: 'LIVE', ui: 'rwa' },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    sublabel: '4 features',
    color: '#10B981',
    pos: { top: '38%', left: '6%' },
    thumb: 'screener',
    slides: [
      { name: 'AI Screener', desc: 'Full trading terminal with chart, swap UI, and real-time data', url: 'spectreai.io/token', badge: 'LIVE', ui: 'screener' },
      { name: "Trader's Corner", desc: 'Advanced trading analysis widgets and professional tools', url: 'spectreai.io/traders-corner', badge: 'LIVE', ui: 'traders' },
      { name: 'Liquidation Heatmap', desc: 'Exchange liquidation levels and funding rate visualization', url: 'spectreai.io/liquidation-heatmap', badge: 'LIVE', ui: 'liquidation' },
      { name: 'Predictions', desc: 'Polymarket-powered prediction markets with live odds', url: 'spectreai.io/predictions', badge: 'LIVE', ui: 'predictions' },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis',
    sublabel: '4 features',
    color: '#F59E0B',
    pos: { top: '6%', left: '72%' },
    thumb: 'calendar',
    slides: [
      { name: 'AI Charts', desc: 'AI-powered technical analysis with pattern recognition', url: 'spectreai.io/ai-charts', badge: 'LIVE', ui: 'charts' },
      { name: 'AI Market Analysis', desc: 'AI-generated macro thesis and sector breakdowns', url: 'spectreai.io/ai-market-analysis', badge: 'LIVE', ui: 'analysis' },
      { name: 'Economic Calendar', desc: '657 events from 9 sources with 4-tier impact filtering - FOMC, CPI, NFP, central banks, token unlocks', url: 'spectreai.io/economic-calendar', badge: 'LIVE', ui: 'calendar' },
    ],
  },
  {
    id: 'visualize',
    label: 'Visualize',
    sublabel: '4 features',
    color: '#EF4444',
    pos: { top: '42%', left: '38%' },
    thumb: 'heatmap',
    slides: [
      { name: 'World Map', desc: 'Global crypto activity visualization with regional heatmaps', url: 'spectreai.io/world', badge: 'LIVE', ui: 'world' },
      { name: 'Heatmaps', desc: '24h market performance heatmap by sector or market cap', url: 'spectreai.io/heatmaps', badge: 'LIVE', ui: 'heatmap' },
      { name: 'Bubbles', desc: 'Market cap vs price change bubble chart visualization', url: 'spectreai.io/bubbles', badge: 'LIVE', ui: 'bubbles' },
      { name: 'Fear & Greed', desc: 'Real-time market sentiment gauge with historical overlay', url: 'spectreai.io/fear-greed', badge: 'LIVE', ui: 'feargreed' },
    ],
  },
  {
    id: 'social',
    label: 'Social',
    sublabel: '4 features',
    color: '#06B6D4',
    pos: { top: '36%', left: '68%' },
    thumb: 'pulse',
    slides: [
      { name: 'Pulse', desc: 'Real-time 2-column social feed with curated analysis', url: 'spectreai.io/pulse', badge: 'LIVE', ui: 'pulse' },
      { name: 'Social Zone', desc: 'Aggregated social metrics and trending discussions', url: 'spectreai.io/social-zone', badge: 'LIVE', ui: 'socialzone' },
      { name: 'AI Media Center', desc: 'Curated video, podcasts, and market multimedia content', url: 'spectreai.io/ai-media-center', badge: 'LIVE', ui: 'media' },
      { name: 'X Intelligence', desc: 'Full-viewport social graph mapping influencer networks', url: 'spectreai.io/x-intelligence', badge: 'LIVE', ui: 'xgraph' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    sublabel: '3 features',
    color: '#A78BFA',
    pos: { top: '70%', left: '22%' },
    thumb: 'watchlist',
    slides: [
      { name: 'Watchlists', desc: 'Unlimited custom lists with sparklines, alerts, and tracking', url: 'spectreai.io/watchlists', badge: 'LIVE', ui: 'watchlist' },
      { name: 'Categories', desc: 'Browse tokens by sector - L1, DeFi, AI, Gaming, and more', url: 'spectreai.io/categories', badge: 'LIVE', ui: 'categories' },
      { name: 'Lens', desc: 'Deep-dive comparison tool for head-to-head token analysis', url: 'spectreai.io/lens', badge: 'LIVE', ui: 'lens' },
    ],
  },
  {
    id: 'marketplace',
    label: 'Developer Platform',
    sublabel: '4 surfaces',
    color: '#3B82F6',
    pos: { top: '66%', left: '62%' },
    thumb: 'widgets',
    slides: [
      { name: 'User Dashboard', desc: 'Portal for API keys, usage analytics, billing, and team seats across every Spectre product', url: 'spectreai.io/account', badge: 'LIVE', ui: 'user-dashboard' },
      { name: 'Status', desc: 'Real-time platform health, uptime, and incident history across every Spectre service', url: 'status.spectreai.io', badge: 'LIVE', ui: 'status' },
      { name: 'API Platform', desc: '500+ endpoints for real-time market data, on-chain analytics, and AI insights', url: 'spectreai.io/website2/api', badge: 'LIVE', ui: 'api-landing' },
      { name: 'MCP Server', desc: 'Model Context Protocol server connecting AI agents to live crypto data with 178 tools', url: 'mcp.spectreai.io', badge: 'LIVE', ui: 'mcp' },
    ],
  },
]

const TOTAL_FEATURES = PILLARS.reduce((sum, p) => sum + p.slides.length, 0)

/* ══════════════════════════════════════════════════════════════
   Screenshot path helper
   ══════════════════════════════════════════════════════════════ */

// High-res product screenshots are served from a CDN. Base URL is
// env-driven so the files can live on Vercel Blob, Cloudflare R2, etc.
// Paths below are relative to that base — preserved from the original
// /For Website 2/<Pillar>/<file>.png layout so re-uploading is a flat copy.
// The base URL's origin must also appear in img-src in vercel.json CSP.
// Fallback: if no base URL is set, serve from /public (dev convenience).
const SCREENSHOTS_BASE = (import.meta.env.VITE_SCREENSHOTS_BASE_URL || '').replace(/\/$/, '')

// Keys match the `ui` field on each slide. Any key not in this map falls
// back to the legacy /slides/<key>.png.
const SLIDE_IMG_OVERRIDES = {
  // Main
  brief: 'Main/1 - Welcome.png',
  chat: 'Main/5 - Monarch AI.png',
  widgets: 'Main/6 - YOU.png',
  discover: 'Research/1 - Discover.png',

  // Research
  feed: 'Research/3 - Intelligence Feed.png',
  newsroom: 'Research/5 - News.png',
  research: 'Main/2 - Research Zone.png',
  search: 'Research/4 - Search Engine.png',
  ventures: 'Research/2 - Ventures.png',
  rwa: 'Research/6 - ZIGChain.png',

  // Trading
  screener: 'Trading/1 - AI Screener.png',
  traders: 'Trading/2 - Traders Corner.png',

  // Analysis
  charts: 'Analysis/1 - AI Charts.png',
  analysis: 'Analysis/3 - AI Market Analysis.png',
  calendar: 'Analysis/4 - Economic Calendar.png',

  // Visualize
  world: 'Visualize/1 - World.png',
  heatmap: 'Visualize/2 - Heatmaps.png',
  bubbles: 'Visualize/3 - Bubbles.png',
  feargreed: 'Visualize/4 - Fear & Greed .png',

  // Social
  xgraph: 'Social/1 - X Intel.png',

  // Tools
  watchlist: 'Main/3 - Watchlists.png',
  categories: 'Tools/1 - Categories.png',

  // Developer Platform
  status: 'Developer platform/Status.png',
  'api-landing': 'Developer platform/API.png',
  mcp: 'Developer platform/MCP.png',
  'user-dashboard': 'Developer platform/1 - User Dashboard.png',
}

function slideImg(uiKey) {
  const override = SLIDE_IMG_OVERRIDES[uiKey]
  if (override) {
    // If a CDN base is configured, join against it; otherwise fall back to
    // bundled /public/For Website 2/ for local dev.
    const base = SCREENSHOTS_BASE || '/For Website 2'
    return encodeURI(`${base}/${override}`)
  }
  return `/slides/${uiKey}.png`
}

/* ══════════════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function FeatureCanvas() {
  const [activePillar, setActivePillar] = useState(null)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [dragOffsets, setDragOffsets] = useState({})
  const [draggingId, setDraggingId] = useState(null)

  const pillar = activePillar ? PILLARS.find(p => p.id === activePillar) : null
  const slideCount = pillar ? pillar.slides.length : 0

  // Drag state ref (avoids re-renders during drag)
  const dragRef = useRef({ active: false, id: null, startX: 0, startY: 0, origX: 0, origY: 0 })

  const openSlider = useCallback((pillarId) => {
    setActivePillar(pillarId)
    setCurrentSlide(0)
    requestAnimationFrame(() => setIsOpen(true))
  }, [])

  const closeSlider = useCallback(() => {
    setIsOpen(false)
    setTimeout(() => {
      setActivePillar(null)
      setCurrentSlide(0)
    }, 350)
  }, [])

  const goToSlide = useCallback((i) => {
    setCurrentSlide(i)
  }, [])

  const nextSlide = useCallback(() => {
    setCurrentSlide(prev => Math.min(prev + 1, slideCount - 1))
  }, [slideCount])

  const prevSlide = useCallback(() => {
    setCurrentSlide(prev => Math.max(prev - 1, 0))
  }, [])

  // Drag handlers
  const onPointerDown = useCallback((e, pillarId) => {
    // Only left click / primary touch
    if (e.button && e.button !== 0) return
    const d = dragRef.current
    const off = dragOffsets[pillarId] || { x: 0, y: 0 }
    d.active = true
    d.id = pillarId
    d.startX = e.clientX
    d.startY = e.clientY
    d.origX = off.x
    d.origY = off.y
    d.moved = false
    e.currentTarget.setPointerCapture(e.pointerId)
    // Apply dragging class immediately (kills float animation + transitions)
    // so the first move doesn't animate or snap weirdly.
    setDraggingId(pillarId)
    // Seed the offset so the inline transform exists on the very first frame,
    // preventing a one-frame jump from float-animated position to origin.
    if (!dragOffsets[pillarId]) {
      setDragOffsets(prev => ({ ...prev, [pillarId]: { x: 0, y: 0 } }))
    }
  }, [dragOffsets])

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true
    // Always track — we already killed animation on pointer down, so no skip.
    setDragOffsets(prev => ({
      ...prev,
      [d.id]: { x: d.origX + dx, y: d.origY + dy }
    }))
  }, [])

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current
    if (!d.active) return
    const wasDrag = d.moved
    const pillarId = d.id
    d.active = false
    d.id = null
    d.moved = false
    setDraggingId(null)
    // Only open slideshow if it was a click, not a drag
    if (!wasDrag) {
      openSlider(pillarId)
    }
  }, [openSlider])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e) {
      if (e.key === 'Escape') closeSlider()
      if (e.key === 'ArrowRight') nextSlide()
      if (e.key === 'ArrowLeft') prevSlide()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, closeSlider, nextSlide, prevSlide])

  // Lock body scroll when overlay open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  return (
    <section className="fc" id="platform">
      {/* Lifestyle background image */}
      <div className="fc-bg-img" />

      {/* Header */}
      <div className="fc-header w2-reveal">
        <h2 className="fc-title">
          Eight products running on one engine.
        </h2>
        <p className="fc-sub">
          Research, trading, social, on-chain, macro, AI, alerts and ventures. They share one data layer, so moving between them doesn&apos;t reset your context.
        </p>
        <div className="fc-hint w2-reveal" role="note">
          <span className="fc-hint-dot" aria-hidden="true" />
          <svg className="fc-hint-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11a3 3 0 1 1 6 0c0 2-3 3-3 3" />
            <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          <span className="fc-hint-text">Click a pillar to explore</span>
        </div>
      </div>

      {/* Scattered file items - draggable */}
      <div className="fc-files">
        {PILLARS.map((p) => {
          const off = dragOffsets[p.id]
          const dragStyle = off
            ? { ...p.pos, transform: `translate(${off.x}px, ${off.y}px)` }
            : p.pos
          const Icon = PILLAR_ICONS[p.id]
          return (
            <div
              key={p.id}
              className={`fc-file fc-file--${p.id}${draggingId === p.id ? ' fc-file--dragging' : ''}${off ? ' fc-file--dragged' : ''}`}
              style={dragStyle}
              onPointerDown={(e) => onPointerDown(e, p.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <div className="fc-thumb">
                {Icon && <Icon color={p.color} />}
              </div>
              <div className="fc-label">{p.label}</div>
              <div className="fc-sublabel">{p.sublabel}</div>
            </div>
          )
        })}
      </div>

      {/* Stats bar */}
      <div className="fc-stats w2-reveal">
        <div className="fc-stat">
          <div className="fc-stat-val">{TOTAL_FEATURES}</div>
          <div className="fc-stat-label">Features</div>
        </div>
        <div className="fc-stat-div" />
        <div className="fc-stat">
          <div className="fc-stat-val">50K+</div>
          <div className="fc-stat-label">Tokens</div>
        </div>
        <div className="fc-stat-div" />
        <div className="fc-stat">
          <div className="fc-stat-val">500+</div>
          <div className="fc-stat-label">Sources</div>
        </div>
      </div>


      {/* SLIDESHOW OVERLAY */}
      <div className={`fc-overlay${isOpen ? ' fc-overlay--open' : ''}`}>
        <div className="fc-overlay-bg" onClick={closeSlider} />
        <div className="fc-overlay-inner">
          {/* Close */}
          <button className="fc-close" onClick={closeSlider}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>

          {/* Pillar header */}
          {pillar && (
            <>
              <div className="fc-o-header">
                <div className="fc-o-dot" style={{ background: pillar.color }} />
                <div className="fc-o-title">{pillar.label}</div>
                <div className="fc-o-count">{pillar.slides.length} features</div>
              </div>

              {/* Slider */}
              <div className="fc-slider">
                <div className="fc-track" style={{ transform: `translateX(-${currentSlide * 100}%)` }}>
                  {pillar.slides.map((slide, i) => (
                    <div className="fc-slide" key={i}>
                      <div className="fc-screen">
                        <div className="fc-chrome">
                          <div className="fc-chrome-dot fc-chrome-r" />
                          <div className="fc-chrome-dot fc-chrome-y" />
                          <div className="fc-chrome-dot fc-chrome-g" />
                          <span className="fc-chrome-url">{slide.url}</span>
                        </div>
                        <div className="fc-screen-body fc-screen-body--img">
                          <img
                            className="fc-slide-img"
                            src={slideImg(slide.ui)}
                            alt={slide.name}
                            loading="lazy"
                            draggable={false}
                          />
                        </div>
                      </div>
                      <div className="fc-caption">
                        <div className="fc-caption-name">{slide.name}</div>
                        <div className="fc-caption-desc">{slide.desc}</div>
                        <div className="fc-caption-badge" style={slide.badge === 'SOON' ? { background: 'rgba(245,158,11,0.08)', color: 'rgba(245,158,11,0.7)', borderColor: 'rgba(245,158,11,0.12)' } : {}}>{slide.badge}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation */}
              <div className="fc-nav">
                <button className={`fc-arrow${currentSlide === 0 ? ' fc-arrow--disabled' : ''}`} onClick={prevSlide}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <div className="fc-dots">
                  {pillar.slides.map((_, i) => (
                    <div
                      key={i}
                      className={`fc-dot${i === currentSlide ? ' fc-dot--active' : ''}`}
                      style={i === currentSlide ? { background: pillar.color } : {}}
                      onClick={() => goToSlide(i)}
                    />
                  ))}
                </div>
                <button className={`fc-arrow${currentSlide === slideCount - 1 ? ' fc-arrow--disabled' : ''}`} onClick={nextSlide}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
