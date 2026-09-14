import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import FeatureCanvas from './components/feature-canvas'
import BgMusicToggle from './components/bg-music'
import { getOfficialTweets, normalizeOfficialTweet } from '../../services/spectreApi'
import { useSEO, SEO_PRESETS } from '../../lib/useSEO'
import './website2.css'

// ── Tweet helpers (shared with /lp) ─────────────────────────────
function w2FormatCount(n) {
  const num = Number(n) || 0
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return String(num)
}
function w2FormatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function w2CleanTweetText(raw) {
  if (!raw) return ''
  let text = String(raw)
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
  text = text.replace(/\s*https?:\/\/t\.co\/\S+\s*$/gi, '').trim()
  return text
}

/* ══════════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════════ */

const NAV_LINKS = [
  { label: 'Home', id: 'home', icon: 'home' },
  { label: 'Live Demo', id: 'demo', icon: 'play' },
  { label: 'Token', id: 'token', icon: 'prism' },
  { label: 'Backed By', id: 'backed', icon: 'cube' },
  { label: 'Product Market Fit', id: 'gap', icon: 'chart' },
  { label: 'Atlas', id: 'atlas', icon: 'compass' },
  { label: 'Pricing', id: 'pricing', icon: 'dollar' },
  { label: 'Roadmap', id: 'roadmap', icon: 'flag' },
  { label: 'Intelligence', id: 'social-intel', icon: 'signal' },
  { label: 'Team', id: 'team', icon: 'people' },
  { label: 'API', href: '/website2/api', icon: 'terminal' },
]

/* Inline outline icons — 1.75 stroke, rounded linecaps. Sized 18px in drawer.
   Purposefully geometric and financial — no robots, no sparkles, no brains. */
const W2_DRAWER_ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h5v-6h4v6h5V10" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="14" rx="2" /><path d="M10 9.5v3l3-1.5-3-1.5Z" /><path d="M8 21h8" />
    </svg>
  ),
  prism: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 19h16L12 3Z" /><path d="M12 3v16" /><path d="M12 11l-4 4" /><path d="M12 11l4 4" />
    </svg>
  ),
  cube: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" /><path d="M3 7.5 12 12l9-4.5" /><path d="M12 12v9" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V5" /><path d="M4 20h16" /><path d="M7 16l4-4 3 3 5-6" /><path d="M15 9h4v4" />
    </svg>
  ),
  compass: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-5 2-2 5 5-2 2-5Z" />
    </svg>
  ),
  dollar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18" /><path d="M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.6 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3" />
    </svg>
  ),
  flag: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4" /><path d="M5 4h11l-2 3.5L16 11H5" />
    </svg>
  ),
  signal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V14" /><path d="M9 20v-9" /><path d="M14 20V8" /><path d="M19 20V4" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="9" r="3" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 8a3 3 0 0 1 0 6" /><path d="M18 19c0-2 1-3.5 3-4" />
    </svg>
  ),
  terminal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 10 3 2-3 2" /><path d="M13 14h4" />
    </svg>
  ),
}

// Full feature atlas - 8 categories, every tool in the platform
const ATLAS_CATEGORIES = [
  {
    num: '01',
    title: 'Command Center',
    sub: 'Open the app, read the market in 90 seconds.',
    items: [
      { label: 'Welcome Dashboard', path: '/' },
      { label: 'GM Dashboard', path: '/gm-dashboard' },
      { label: 'Spectre You', path: '/you' },
      { label: 'Discover', path: '/discover' },
      { label: 'Watchlists', path: '/watchlists' },
      { label: 'Whisper Search', path: '/search-engine' },
      { label: 'Alerts', path: '/alerts' },
    ],
  },
  {
    num: '02',
    title: 'Deep Research',
    sub: 'Institutional grade due diligence on any asset.',
    items: [
      { label: 'Spectre Brain', path: '/brain' },
      { label: 'Research Zone', path: '/research-zone/bitcoin' },
      { label: 'Token Detail', path: '/trade' },
      { label: 'Categories', path: '/categories' },
      { label: 'ROI Calculator', path: '/roi-calculator' },
    ],
  },
  {
    num: '03',
    title: 'Market Structure',
    sub: 'See the whole market in one glance. Zoom anywhere.',
    items: [
      { label: 'Heatmaps', path: '/heatmaps' },
      { label: 'Bubbles', path: '/bubbles' },
      { label: 'Liquidation Heatmap', path: '/liquidation-heatmap' },
      { label: 'World View', path: '/world' },
      { label: 'Lens', path: '/lens' },
    ],
  },
  {
    num: '04',
    title: 'Intelligence & News',
    sub: 'Editorial grade reporting, not Twitter noise.',
    items: [
      { label: 'Intelligence', path: '/intelligence' },
      { label: 'Intelligence Feed', path: '/insights' },
      { label: 'Newsroom', path: '/newsroom' },
      { label: 'News Reader', path: '/news' },
      { label: 'Social Zone', path: '/social-zone' },
      { label: 'AI Media Center', path: '/ai-media-center' },
    ],
  },
  {
    num: '05',
    title: 'Sentiment & Macro',
    sub: 'The why behind every market move.',
    items: [
      { label: 'Sentiment Analysis', path: '/sentiment' },
      { label: 'Fear & Greed', path: '/fear-greed' },
      { label: 'Economic Calendar', path: '/economic-calendar' },
      { label: 'AI Market Analysis', path: '/ai-market-analysis' },
      { label: 'Predictions', path: '/predictions' },
    ],
  },
  {
    num: '06',
    title: 'Private Markets',
    sub: 'Alpha from the pre token stage onwards.',
    items: [
      { label: 'Ventures', path: '/ventures' },
      { label: 'Private Markets', path: '/private-markets' },
      { label: 'Tokenized Assets (RWA)', path: '/tokenized-assets' },
      { label: 'ZIGChain', path: '/zigchain' },
    ],
  },
  {
    num: '07',
    title: 'Trading & Flow',
    sub: 'Real flows, funding rates, liquidation zones.',
    items: [
      { label: "Traders' Corner", path: '/traders-corner' },
      { label: 'Technical Analysis', path: '/technical-analysis' },
      { label: 'AI Charts', path: '/ai-charts' },
      { label: 'AI Screener', path: '/ai-screener' },
      { label: 'X Dashboard', path: '/x-dash' },
    ],
  },
  {
    num: '08',
    title: 'AI Copilot',
    sub: 'Natural language research. Streamed, cited, honest.',
    items: [
      { label: 'Monarch Chat', path: '/monarch-chat' },
      { label: 'X Intelligence', path: '/x-intelligence' },
      { label: 'X Intel', path: '/x-intel' },
      { label: 'X Bubbles', path: '/x-bubbles' },
      { label: 'Pulse', path: '/pulse' },
    ],
  },
  {
    num: '09',
    title: 'Market Coverage',
    sub: 'Every asset class, one platform.',
    items: [
      { label: 'Crypto',      accentKey: 'crypto' },
      { label: 'Stocks',      accentKey: 'stocks' },
      { label: 'Commodities', accentKey: 'commodities' },
      { label: 'Macro',       accentKey: 'macro' },
    ],
  },
]

// Category accents (rgb for glass-compatible rgba tinting)
// Each entry uses the category's real title — no invented short labels.
const ATLAS_ACCENTS = {
  '01':         { rgb: '107, 154, 232', tag: 'Command Center' },
  '02':         { rgb: '16, 185, 129',  tag: 'Deep Research' },
  '03':         { rgb: '245, 158, 11',  tag: 'Market Structure' },
  '04':         { rgb: '236, 72, 153',  tag: 'Intelligence & News' },
  '05':         { rgb: '139, 92, 246',  tag: 'Sentiment & Macro' },
  '06':         { rgb: '249, 115, 22',  tag: 'Private Markets' },
  '07':         { rgb: '20, 184, 166',  tag: 'Trading & Flow' },
  '08':         { rgb: '59, 130, 246',  tag: 'AI Copilot' },
  social:       { rgb: '180, 140, 240', tag: 'Social' },
  crypto:       { rgb: '247, 147, 26',  tag: 'Coverage' },
  stocks:       { rgb: '34, 211, 238',  tag: 'Coverage' },
  commodities:  { rgb: '234, 179, 8',   tag: 'Coverage' },
  macro:        { rgb: '244, 63, 94',   tag: 'Coverage' },
}

// Tools that are actually social-data surfaces, regardless of where they
// sit in ATLAS_CATEGORIES for nav purposes. These get re-tagged to "Social".
const SOCIAL_TOOLS = new Set([
  'X Intelligence',
  'X Intel',
  'X Beta',
  'X Bubbles',
  'X Dashboard',
  'Pulse',
  'Social Zone',
])

// Flattened tool list for the Atlas tile grid — every surface, one tile each.
// Item-level accentKey wins over category default; social override wins over category.
const ATLAS_TOOLS = ATLAS_CATEGORIES.flatMap((cat) =>
  cat.items.map((item) => {
    const accent = item.accentKey
      ? ATLAS_ACCENTS[item.accentKey]
      : SOCIAL_TOOLS.has(item.label)
        ? ATLAS_ACCENTS.social
        : ATLAS_ACCENTS[cat.num] || ATLAS_ACCENTS['01']
    return {
      label: item.label,
      path: item.path,
      catNum: cat.num,
      catTitle: cat.title,
      accent,
    }
  })
)

// Editorial capability blocks - flat institutional stat grid
const WHY_BLOCKS = [
  { tone: 'a', num: '50,000', suffix: '+',  label: 'Assets tracked' },
  { tone: 'b', num: '47,000', suffix: '',   label: 'X accounts monitored' },
  { tone: 'c', num: 'All',    suffix: '',   label: 'Chains streamed' },
  { tone: 'd', num: '500',    suffix: '+',  label: 'API endpoints' },
]

const PRODUCT_TABS = [
  {
    id: 'command',
    label: 'Command Center',
    tagline: 'Your daily briefing',
    desc: 'AI-generated market briefs, sentiment gauges, watchlist snapshots, and macro context. Everything you need in 90 seconds.',
    tools: ['AI Brief', 'Fear & Greed', 'Watchlists', 'Market Stats', 'GM Dashboard'],
    color: '#6B9AE8',
    iconPath: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  },
  {
    id: 'research',
    label: 'Research & Discovery',
    tagline: 'Deep dive on any asset',
    desc: 'Institutional-grade research on any token. AI-written theses, real-time charts, on-chain metrics, and social sentiment in one view.',
    tools: ['Research Zone', 'Token Detail', 'Discover', 'Search Engine', 'Categories'],
    color: '#10B981',
    iconPath: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  },
  {
    id: 'trading',
    label: 'Trading & Intelligence',
    tagline: 'Professional-grade tools',
    desc: 'AI Charts, liquidation heatmaps, news engine, X sentiment, and social pulse tracking. Everything a trader needs, unified.',
    tools: ['AI Charts', 'Liquidation Heatmap', 'Intelligence Hub', 'X Dashboard', 'Social Zone', 'Heatmaps'],
    color: '#F59E0B',
    iconPath: 'M12 20V10M18 20V4M6 20v-4',
  },
  {
    id: 'ai',
    label: 'AI Agents',
    tagline: 'Autonomous intelligence',
    desc: 'Specialized AI agents that analyze markets 24/7. Conversational assistant, automated reports, and pattern detection.',
    tools: ['Monarch Chat', 'AI Market Analysis', 'GM Dashboard', 'Agent System'],
    color: '#3B82F6',
    iconPath: 'M12 2L9 8.5L3 10l4.5 5L6 21l6-3l6 3l-1.5-6L21 10l-6-1.5L12 2z',
  },
]

const STATS = [
  { value: '2,400+', label: 'Active Traders' },
  { value: '50,000+', label: 'Tokens Tracked' },
  { value: '500+', label: 'Data Sources' },
  { value: '24/7', label: 'AI Monitoring' },
]

const TEAM = [
  {
    name: 'Sunny',
    role: 'Founder & CEO',
    tag: 'Product · Distribution',
    accent: '#6B9AE8',
    linkedin: 'https://www.linkedin.com/in/click2sunny/',
  },
  {
    name: 'Gleb',
    role: 'Co-founder & COO',
    tag: 'Ops · Trading desk',
    accent: '#A78BFA',
    linkedin: 'https://www.linkedin.com/in/gleb02f/',
  },
  {
    name: 'Alaa',
    role: 'CTO',
    tag: 'AI · Research',
    accent: '#20BEFF',
    linkedin: 'https://www.linkedin.com/in/alaafikry/',
    kaggle: 'https://www.kaggle.com/takedown',
  },
  {
    name: 'Haitham',
    role: 'Backend Engineer',
    tag: 'Infra · Data pipes',
    accent: '#FBBF24',
  },
  {
    name: 'KD',
    role: 'Blockchain Engineer',
    tag: 'Solidity · On-chain',
    accent: '#10B981',
    linkedin: 'https://www.linkedin.com/in/krzysztof-dryja-89300827/',
  },
  {
    name: 'Adamski',
    role: 'Security Lead',
    tag: 'Security · Infra',
    accent: '#EC4899',
    github: 'https://github.com/admsk2',
  },
  {
    name: 'Evgeniy',
    role: 'Engineer',
    tag: 'Full-stack',
    accent: '#F97316',
    linkedin: 'https://www.linkedin.com/in/evgeniy-shvets/',
    github: 'https://github.com/EvgeniyShvetss',
  },
]

const ROADMAP = [
  {
    date: 'April 2026',
    title: 'Beta Launch',
    desc: 'Research Platform goes public. 50,000+ assets, real-time data across 8 chains, AI intelligence agents, social signals, Intelligence Hub with daily research. Token-gated access via $SPECTRE (three tiers: 500 / 1,000 / 7,000).',
    status: 'active',
  },
  {
    date: 'May - June 2026',
    title: 'Full Product Suite',
    desc: 'Complete platform rollout. All intelligence tools live. Cinema mode, day/night themes, multi-watchlist, AI agent with full platform context. API marketplace opens, giving developers access to Spectre\'s intelligence layer programmatically.',
    status: 'upcoming',
  },
  {
    date: 'July - August 2026',
    title: 'Trading Terminal',
    desc: 'Trading terminal launch. Swap execution, research context alongside trades. The full loop from intelligence to action inside one platform.',
    status: 'upcoming',
  },
  {
    date: 'Q3 2026',
    title: 'Mobile + Distribution',
    desc: 'App Store and Google Play submissions. PWA already live. Spectre Ventures launches, applying intelligence-grade research to early-stage projects. Chrome extension injecting intelligence into third-party platforms.',
    status: 'upcoming',
  },
  {
    date: 'Q4 2026',
    title: 'CEX Listing + Enterprise',
    desc: '$SPECTRE listed on centralized exchanges. Institutional API licensing begins. Enterprise marketing engine for Web3 projects.',
    status: 'upcoming',
  },
  {
    date: '2027',
    title: 'Market Infrastructure',
    desc: 'Spectre becomes the default intelligence source. AI-generated research indexed and cited across web and AI search. Agent ecosystem expands. Multi-asset coverage deepens.',
    status: 'upcoming',
  },
  {
    date: '2028',
    title: 'Intelligence Standard',
    desc: 'Spectre intelligence embedded across the trading ecosystem. The origin point for market research, not a consumer of it.',
    status: 'upcoming',
  },
]

const ROADMAP_EVENTS = [
  { label: 'Beta Launch', date: 'April 2026', done: true },
  { label: 'Full Product Suite', date: 'May/June 2026' },
  { label: 'API Marketplace', date: 'June 2026' },
  { label: 'Trading Terminal', date: 'July/August 2026' },
  { label: 'Mobile (App Store + Google Play)', date: 'Q3 2026' },
  { label: 'Spectre Ventures', date: 'Q3 2026' },
  { label: 'CEX Listing', date: 'Q4 2026' },
  { label: 'Institutional API + Enterprise', date: 'Q4 2026' },
  { label: 'Intelligence Infrastructure', date: '2027' },
]

const DOC_LINKS = [
  { label: 'Whitepaper', href: '#', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  { label: 'Pitch Deck', href: '#', icon: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5' },
  { label: 'GitHub', href: '#', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
  { label: 'Roadmap PDF', href: '#', icon: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3' },
]

const TIERS = [
  { name: 'Starter', amount: '500+', desc: 'Core dashboards, basic AI analysis, multi-chain data access.', accent: 'rgba(107,154,232,0.15)' },
  { name: 'Pro', amount: '1,000+', desc: 'Advanced research, whale alerts, premium AI agents, priority support.', accent: 'rgba(16,185,129,0.15)' },
  { name: 'Elite', amount: '7,000+', desc: 'Full platform access, institutional tools, API, custom reports.', accent: 'rgba(236,72,153,0.15)' },
]

const PRICING_PLANS = [
  {
    name: 'Free',
    subPrice: '$0',
    subPeriod: '/mo',
    tokenAmount: null,
    desc: 'Get started with essential market data.',
    features: ['Market overview dashboard', 'Top 100 token tracking', 'Basic news feed', 'Community access', '1 watchlist'],
    accent: 'rgba(255,255,255,0.06)',
    accentBorder: 'rgba(255,255,255,0.08)',
  },
  {
    name: 'Pro',
    subPrice: '$29',
    subPeriod: '/mo',
    tokenAmount: '1,000+',
    desc: 'For serious traders who need an edge.',
    features: ['Everything in Free', 'AI Morning Brief', 'Research Zone access', 'Whale alerts', '10 watchlists', 'Fear & Greed analytics', 'Liquidation heatmap'],
    popular: true,
    accent: 'rgba(16,185,129,0.1)',
    accentBorder: 'rgba(16,185,129,0.25)',
  },
  {
    name: 'Max',
    subPrice: '$79',
    subPeriod: '/mo',
    tokenAmount: '5,000+',
    desc: 'Full power for professional analysts.',
    features: ['Everything in Pro', 'Monarch AI chat agent', 'Social pulse tracking', 'AI Charts & analysis', 'Sector deep dives', 'Unlimited watchlists', 'Priority support'],
    accent: 'rgba(107,154,232,0.1)',
    accentBorder: 'rgba(107,154,232,0.25)',
  },
  {
    name: 'Enterprise',
    subPrice: 'Custom',
    subPeriod: '',
    tokenAmount: '7,000+',
    desc: 'White-label solutions for institutions.',
    features: ['Everything in Max', 'API access', 'Custom reports & dashboards', 'Team seats & permissions', 'Dedicated account manager', 'SLA guarantees', 'On-chain compliance tools'],
    accent: 'rgba(236,72,153,0.08)',
    accentBorder: 'rgba(236,72,153,0.2)',
  },
]

// Credibility tiles - every partnership is a signed contract.
// The accomplishment is the headline, not the company name.
const BACKED_BY = [
  {
    num: '01',
    headline: 'Google for Startups Member',
    subhead: 'with $200,000 Scale Tier',
    detail: 'Direct $200,000 in Google Cloud credits. BigQuery pipelines. Signed support from the Google for Startups team.',
    domain: 'startup.google.com',
    brand: '#4285F4',
    glow: 'rgba(66, 133, 244, 0.35)',
    logoKey: 'google',
    chip: 'Verified Member',
  },
  {
    num: '02',
    headline: 'NVIDIA for Startups',
    subhead: 'AI Startup Program Member',
    detail: 'H100 cluster compute for Monarch inference. Deep Learning Institute credits. Partner go-to-market resources.',
    domain: 'nvidia.com',
    brand: '#76B900',
    glow: 'rgba(118, 185, 0, 0.35)',
    logoKey: 'nvidia',
    chip: 'Verified Member',
  },
  {
    num: '03',
    headline: 'TradingView Licence Agreement',
    subhead: 'Advanced Charts, licensed',
    detail: 'The same charting engine that powers Coinbase, Binance, and CoinGecko. Licensed into every Spectre surface.',
    domain: 'tradingview.com',
    brand: '#2962FF',
    glow: 'rgba(41, 98, 255, 0.35)',
    logoKey: 'tradingview',
    chip: 'Licensed Partner',
  },
  {
    num: '04',
    headline: 'Bitquery Data Partner',
    subhead: 'On-chain pipeline, 40+ networks',
    detail: 'Indexed on-chain data across 40+ networks. Wallet, transfer, and DEX trade streams powering Spectre intelligence.',
    domain: 'bitquery.io',
    brand: '#FF7A00',
    glow: 'rgba(255, 122, 0, 0.35)',
    logoKey: 'bitquery',
    chip: 'Data Partner',
  },
]

// Real brand logos - PNGs served from /public/. Crisp at any size, same-origin.
// User-supplied marks live at the project root; Google falls back to the
// /partners/ download we grabbed in the same pass.
const BACKED_LOGO_SRC = {
  google: '/partners/google.png',
  tradingview: '/tradingviewlogo-freelogovectors.net_.png',
  nvidia: '/NVIDIA_logo.svg.png',
  bitquery: '/bitquery-logo.png',
}
const BackedLogo = ({ kind }) => {
  const src = BACKED_LOGO_SRC[kind]
  if (!src) return null
  return (
    <img
      src={src}
      alt={`${kind} logo`}
      className="w2-backed-logo-img"
      loading="lazy"
      draggable="false"
    />
  )
}

// Data sources we consume via API (Web2 stack)
const DATA_SOURCES = [
  { name: 'CoinGecko', icon: 'https://www.google.com/s2/favicons?domain=coingecko.com&sz=32' },
  { name: 'Binance', icon: 'https://www.google.com/s2/favicons?domain=binance.com&sz=32' },
  { name: 'Codex', icon: 'https://www.google.com/s2/favicons?domain=codex.io&sz=32' },
  { name: 'Yahoo Finance', icon: 'https://www.google.com/s2/favicons?domain=finance.yahoo.com&sz=32' },
  { name: 'Perplexity AI', icon: 'https://www.google.com/s2/favicons?domain=perplexity.ai&sz=32' },
  { name: 'Anthropic', icon: 'https://www.google.com/s2/favicons?domain=anthropic.com&sz=32' },
  { name: 'PostHog', icon: 'https://www.google.com/s2/favicons?domain=posthog.com&sz=32' },
  { name: 'Vercel', icon: 'https://www.google.com/s2/favicons?domain=vercel.com&sz=32' },
  { name: 'Finnhub', icon: 'https://www.google.com/s2/favicons?domain=finnhub.io&sz=32' },
  { name: 'Polygon.io', icon: 'https://www.google.com/s2/favicons?domain=polygon.io&sz=32' },
  { name: 'CryptoPanic', icon: 'https://www.google.com/s2/favicons?domain=cryptopanic.com&sz=32' },
  { name: 'ElevenLabs', icon: 'https://www.google.com/s2/favicons?domain=elevenlabs.io&sz=32' },
]
// Web3 partners - add more later
const WEB3_PARTNERS = [
  { name: 'Uniswap', icon: 'https://www.google.com/s2/favicons?domain=uniswap.org&sz=32' },
  { name: 'Jupiter', icon: 'https://www.google.com/s2/favicons?domain=jup.ag&sz=32' },
  { name: 'ZigChain', icon: 'https://www.google.com/s2/favicons?domain=zigchain.com&sz=32' },
  { name: 'Privy', icon: 'https://www.google.com/s2/favicons?domain=privy.io&sz=32' },
  { name: 'DexScreener', icon: 'https://www.google.com/s2/favicons?domain=dexscreener.com&sz=32' },
]

// Each slide carries its own object-position so the subject stays framed
// on every aspect ratio. Desktop = landscape crop; mobile = portrait crop
// tuned to keep the hero subject visible on narrow viewports.
// Hero videos. Env overrides (VITE_SPECTRE_LIFE_URL / VITE_SPECTRE_MOVIE_URL)
// let Vercel swap local /public files for CDN URLs (Vercel Blob, R2, S3)
// without touching code — matches how this repo already served the videos
// before the launch-day port. Falls back to bundled /public files if unset.
const CDN_SPECTRE_LIFE = import.meta.env.VITE_SPECTRE_LIFE_URL || '/spectre-life.mp4'
const CDN_SPECTRE_MOVIE = import.meta.env.VITE_SPECTRE_MOVIE_URL || '/spectre-movie.mp4'

const HERO_SLIDES = [
  {
    label: 'The Spectre Life',
    sublabel: 'See the Vision',
    media: CDN_SPECTRE_LIFE,
    type: 'video',
    fullVideo: true,
    startAt: 0,
    poster: '/spectre-hero-poster.jpg',
    objectPositionDesktop: '50% 50%',
    objectPositionMobile: '50% 50%',
  },
  {
    label: 'Market Intelligence',
    sublabel: 'See the Full Picture',
    media: CDN_SPECTRE_MOVIE,
    type: 'video',
    fullVideo: true,
    startAt: 2,
    poster: '/spectre-hero-poster.jpg',
    objectPositionDesktop: '50% 40%',
    objectPositionMobile: '50% 42%',
  },
  // Slide 3 (AI Screener) removed — no video source yet.
]

const SECTION_IDS = ['home', 'demo', 'backed', 'gap', 'why', 'atlas', 'caps', 'token', 'pricing', 'roadmap', 'social-intel', 'team']

const API_EXAMPLES = [
  {
    tab: 'Breaking News',
    endpoint: 'GET /v1/news/breaking',
    color: '#6B9AE8',
    code: `const res = await fetch(
  'https://api.spectreai.io/v1/news/breaking',
  { headers: { 'X-API-KEY': key } }
)
const { data } = await res.json()`,
    response: `{
  "data": [
    {
      "title": "Whale moves 4,200
  BTC to Binance",
      "category": "onchain",
      "relatedAssets": ["BTC"],
      "severity": "alert",
      "score": 86
    }
  ]
}`,
  },
  {
    tab: 'Token Data',
    endpoint: 'GET /v1/coins/:id',
    color: '#10B981',
    code: `const res = await fetch(
  'https://api.spectreai.io/v1/coins/bitcoin',
  { headers: { 'X-API-KEY': key } }
)
const { name, market_data,
  categories } = await res.json()`,
    response: `{
  "id": "bitcoin",
  "symbol": "btc",
  "name": "Bitcoin",
  "market_data": {
    "current_price": { "usd": 84210.50 },
    "price_change_percentage_24h": 2.34,
    "market_cap": { "usd": 1660000000000 }
  }
}`,
  },
  {
    tab: 'Whale Alerts',
    endpoint: 'GET /v1/smart-money/whale-transactions',
    color: '#EC4899',
    code: `const res = await fetch(
  'https://api.spectreai.io/v1/smart-money/whale-transactions',
  { headers: { 'X-API-KEY': key } }
)
const { data } = await res.json()`,
    response: `{
  "data": [
    {
      "asset": "BTC",
      "amount": 4200,
      "amount_usd": 354000000,
      "from_label": "Unknown",
      "to_label": "Binance",
      "chain": "bitcoin"
    }
  ]
}`,
  },
  {
    tab: 'Sentiment',
    endpoint: 'GET /v1/sentiment/:symbol',
    color: '#F59E0B',
    code: `const res = await fetch(
  'https://api.spectreai.io/v1/sentiment/ETH',
  { headers: { 'X-API-KEY': key } }
)
const { score, label,
  sources, trend } = await res.json()`,
    response: `{
  "symbol": "ETH",
  "score": 61,
  "label": "GREED",
  "trend": "RISING",
  "sources": {
    "x_posts": 18420,
    "positive_pct": 64,
    "narratives": [
      "staking yields",
      "ETF inflows"
    ]
  }
}`,
  },
]

/* ══════════════════════════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function Website2Page() {
  useSEO(SEO_PRESETS.website2)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const videoRef = useRef(null)
  const timelineRef = useRef(null)
  const wirePathRef = useRef(null)
  const [wireProgress, setWireProgress] = useState(0)
  const [emailInput, setEmailInput] = useState('')
  const [activeSection, setActiveSection] = useState('home')
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [isPaused, setIsPaused] = useState(true)
  const [hasStarted, setHasStarted] = useState(false)
  // activeProductTab removed - replaced by FeatureCanvas component
  const [heroSlide, setHeroSlide] = useState(0)
  const [pricingMode, setPricingMode] = useState('token') // 'token' | 'subscription'  — token first; subscription is "Coming Soon"
  const [caCopied, setCaCopied] = useState(false)
  const [activeApiTab, setActiveApiTab] = useState(0)
  const [activeCap, setActiveCap] = useState(0)
  const [apiTypedLen, setApiTypedLen] = useState(0)
  const [showApiResponse, setShowApiResponse] = useState(false)
  const [partnersView, setPartnersView] = useState('data') // 'data' | 'web3'
  const [w2Tweets, setW2Tweets] = useState([])
  const [socialsOpen, setSocialsOpen] = useState(false)
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [waitlistEmail, setWaitlistEmail] = useState('')
  const [waitlistTelegram, setWaitlistTelegram] = useState('')
  const [waitlistStatus, setWaitlistStatus] = useState('idle') // idle | submitting | success | error
  const [thanksOpen, setThanksOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Honeypot field — real users never fill it, bots auto-fill every input.
  // A non-empty value on submit makes the server 200 + drop silently.
  const waitlistHpRef = useRef(null)
  // Attribution: captured ONCE on mount. document.referrer goes blank on
  // same-page navigation and UTM params disappear after the first route
  // change, so we freeze them in a ref the moment the page loads.
  const attributionRef = useRef({ referrer: '', utm: {} })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const utm = {}
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = params.get(k)
      if (v) utm[k] = v
    }
    attributionRef.current = {
      referrer: document.referrer || '',
      utm,
    }
  }, [])

  // Lock body scroll when mobile nav is open. Uses a class (not inline styles)
  // so we don't fight with any other effect or CSS. Cleanup is deterministic:
  // if the component unmounts with the drawer open, the class goes away.
  useEffect(() => {
    const cls = 'w2-body-scroll-locked'
    if (mobileNavOpen) document.body.classList.add(cls)
    else document.body.classList.remove(cls)
    return () => document.body.classList.remove(cls)
  }, [mobileNavOpen])

  /**
   * POSTs a signup to /api/waitlist (Firebase Firestore + Resend email).
   * Returns true on success so the caller can decide how to react (thanks
   * modal, inline state, etc). Fire-and-forget friendly: if the server is
   * unreachable the caller simply treats it as an error and shows the
   * retry state, no lost signups.
   *
   * Extra fields (telegram, hp) come from state — only the rail + door
   * forms expose those inputs; footer form sends just `email`.
   */
  const fireWaitlistWebhook = async (email, source) => {
    try {
      const { referrer, utm } = attributionRef.current
      const r = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          telegram: waitlistTelegram.trim() || null,
          source,
          hp: waitlistHpRef.current?.value || '',
          referrer,
          ...utm,
        }),
      })
      const json = await r.json().catch(() => ({}))
      return !!(r.ok && json.ok)
    } catch (_) {
      return false
    }
  }

  const submitWaitlist = (e, source = 'website-rail') => {
    if (e && e.preventDefault) e.preventDefault()
    const email = waitlistEmail.trim()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setWaitlistStatus('error')
      return
    }
    setWaitlistStatus('submitting')
    fireWaitlistWebhook(email, source).then((ok) => {
      if (ok) {
        setWaitlistStatus('success')
        setThanksOpen(true)
      } else {
        setWaitlistStatus('error')
      }
    })
  }

  // Close modal on Escape
  useEffect(() => {
    if (!thanksOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setThanksOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [thanksOpen])


  // Load fonts
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
    document.head.appendChild(link)
    return () => { if (link.parentNode) link.parentNode.removeChild(link) }
  }, [])

  // Mark the <html> element so the CSS safety net kicks in. No inline styles —
  // this guarantees mobile scrolling works and can't be clobbered by StrictMode
  // double-mount races or downstream effect ordering.
  useEffect(() => {
    document.documentElement.classList.add('w2-html-scope')
    return () => document.documentElement.classList.remove('w2-html-scope')
  }, [])

  // Section observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => { entries.forEach((e) => { if (e.isIntersecting) setActiveSection(e.target.id) }) },
      { threshold: 0.4 }
    )
    SECTION_IDS.forEach((id) => { const el = document.getElementById(id); if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [])

  // Scroll tracking
  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 60)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Load official @Spectre__AI tweets (originals only) for the social feed section.
  // Shows the last 6 main posts (no replies, no retweets) and refreshes every 90s
  // so the feed stays near real-time without hammering the upstream API.
  useEffect(() => {
    let cancelled = false
    const isOriginalPost = (t) => {
      const text = (t?.tweet_text || '').trim()
      const user = (t?.username || '').toLowerCase()
      if (!text) return false
      if (user !== 'spectre__ai') return false
      if (/^RT\s*@/i.test(text)) return false
      if (t?.is_retweet === true || t?.retweeted === true || t?.retweeted_status) return false
      if (/^@\w+/.test(text)) return false
      if (t?.in_reply_to_status_id || t?.in_reply_to_user_id || t?.is_reply === true) return false
      const isQuoteReaction = /\b(this\s+(post|tweet|one|guy|take|thread)|very proud|so proud|great post|big if true|same energy)\b/i.test(text)
      if (isQuoteReaction && text.length < 100) return false
      return true
    }
    const tweetTs = (t) => {
      const v = t?.created_at || t?.createdAt || t?.timestamp || t?.date
      if (!v) return 0
      const n = typeof v === 'number' ? v : Date.parse(v)
      return Number.isFinite(n) ? n : 0
    }
    const fetchLatest = async (force = false) => {
      try {
        const data = await getOfficialTweets('Spectre__AI', { force })
        if (cancelled || !data) return
        const raw = Array.isArray(data) ? data : (data?.results || data?.tweets || [])
        const normalized = raw
          .filter(isOriginalPost)
          .slice()
          .sort((a, b) => tweetTs(b) - tweetTs(a))
          .map((t, i) => normalizeOfficialTweet(t, i))
          .filter((t) => t.text && t.text.length > 0)
          .slice(0, 6)
        if (!cancelled && normalized.length) setW2Tweets(normalized)
      } catch { /* silent */ }
    }
    fetchLatest(true)
    const interval = setInterval(() => fetchLatest(true), 90_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Scroll reveal - use MutationObserver to catch dynamically added elements
  useEffect(() => {
    let disposed = false
    const io = new IntersectionObserver(
      (entries) => { if (disposed) return; entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('w2-visible'); io.unobserve(e.target) } }) },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    )
    const observeAll = () => {
      if (disposed) return
      document.querySelectorAll('.w2-reveal:not(.w2-visible)').forEach((el) => io.observe(el))
    }
    // Initial pass after React settles
    const rafId = requestAnimationFrame(observeAll)
    // Watch for DOM changes (tab switches, dynamic content)
    const mo = new MutationObserver(observeAll)
    const root = document.querySelector('.w2')
    if (root) mo.observe(root, { childList: true, subtree: true })
    return () => { disposed = true; cancelAnimationFrame(rafId); io.disconnect(); mo.disconnect() }
  }, [])

  // Roadmap wire animation
  useEffect(() => {
    const handleScroll = () => {
      const el = timelineRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight
      const start = vh * 0.85
      const end = vh * 0.15
      if (rect.top > start) { setWireProgress(0); return }
      if (rect.bottom < end) { setWireProgress(1); return }
      const totalTravel = rect.height + start - end
      const traveled = start - rect.top
      setWireProgress(Math.min(1, Math.max(0, traveled / totalTravel)))
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // API terminal typewriter
  useEffect(() => {
    setApiTypedLen(0)
    setShowApiResponse(false)
    const code = API_EXAMPLES[activeApiTab].code
    let i = 0
    const iv = setInterval(() => {
      i++
      setApiTypedLen(i)
      if (i >= code.length) {
        clearInterval(iv)
        setTimeout(() => setShowApiResponse(true), 350)
      }
    }, 14)
    return () => clearInterval(iv)
  }, [activeApiTab])

  const wirePathLength = wirePathRef.current?.getTotalLength?.() || 1400

  // Hero slide auto-advance - pauses during fullVideo slides
  const activeSlide = HERO_SLIDES[heroSlide]
  useEffect(() => {
    if (activeSlide.fullVideo) return // no auto-advance for full videos
    const interval = setInterval(() => {
      setHeroSlide((s) => (s + 1) % HERO_SLIDES.length)
    }, 6000)
    return () => clearInterval(interval)
  }, [heroSlide, activeSlide.fullVideo])

  // Video mounted - configure playback based on slide type
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (activeSlide.fullVideo && hasStarted) {
      // User clicked play - unmute, seek, no loop
      v.currentTime = activeSlide.startAt || 0
      v.muted = false
      v.loop = false
      v.play().catch(() => {})
      setIsMuted(false)
      setIsPaused(false)
      const onEnded = () => {
        const nextIdx = (heroSlide + 1) % HERO_SLIDES.length
        const nextSlide = HERO_SLIDES[nextIdx]
        if (nextSlide.fullVideo) {
          setHeroSlide(nextIdx)
        } else {
          setHasStarted(false)
          setIsPaused(true)
          setHeroSlide(nextIdx)
        }
      }
      v.addEventListener('ended', onEnded)
      return () => { try { v.removeEventListener('ended', onEnded) } catch (_) { /* node may be gone */ } }
    } else if (!activeSlide.fullVideo) {
      // Non-fullVideo slide (e.g. AI Screener) - ambient muted loop
      v.muted = true
      v.loop = true
      setIsMuted(true)
      setIsPaused(false)
    }
  }, [heroSlide, hasStarted])

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  // Pause the hero video whenever it scrolls off-screen. Prevents the video
  // from continuing to play (and pulling audio) after the user navigates away
  // via nav links or scroll anchors. Also collapses back to the poster so the
  // play button can gate re-entry explicitly.
  useEffect(() => {
    const v = videoRef.current
    if (!v || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            try { v.pause() } catch (_) { console.error(_) }
            setIsPaused(true)
          }
        }
      },
      { threshold: 0.15 }
    )
    io.observe(v)
    return () => { try { io.disconnect() } catch (_) { console.error(_) } }
  }, [heroSlide, hasStarted])

  // Handle #section hash on mount (e.g. /website2#roadmap coming from /lp)
  useEffect(() => {
    const hash = window.location.hash?.replace('#', '')
    if (!hash) return
    // wait one frame for layout
    const timer = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="w2">

      {/* ═══════════════════════ STICKY NAV ═══════════════════════ */}
      <nav className={`w2-nav${isScrolled ? ' w2-nav--scrolled' : ''}`}>
        <div className="w2-nav-inner">
          <div className="w2-nav-left" onClick={() => scrollTo('home')} style={{ cursor: 'pointer' }}>
            <img src="/spectre-logo-dark.png" alt="Spectre AI" className="w2-nav-logo" />
            <span className="w2-nav-wordmark">Spectre<span className="w2-nav-wordmark-ai">AI</span></span>
          </div>
          <div className="w2-nav-links">
            {NAV_LINKS.map((link) => (
              <button
                key={link.id || link.href}
                className={`w2-nav-link${activeSection === link.id ? ' w2-nav-link--active' : ''}`}
                aria-current={activeSection === link.id ? 'true' : undefined}
                onClick={() => link.href ? navigate(link.href) : scrollTo(link.id)}
              >
                {link.label}
                {activeSection === link.id && <span className="w2-nav-dot" />}
              </button>
            ))}
          </div>
          <div className="w2-nav-right">
            <button className="w2-btn-ghost w2-btn-ghost--hideMobile" onClick={() => navigate('/lp')}>Open App</button>
            <a className="w2-btn-accent w2-btn-accent--hideMobile" href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6" target="_blank" rel="noopener noreferrer">Buy $SPECTRE</a>
            <button
              type="button"
              className={`w2-nav-burger${mobileNavOpen ? ' w2-nav-burger--open' : ''}`}
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileNavOpen}
              aria-controls="w2-mobile-drawer"
              onClick={() => setMobileNavOpen((v) => !v)}
            >
              <span className="w2-nav-burger-line" />
              <span className="w2-nav-burger-line" />
              <span className="w2-nav-burger-line" />
            </button>
          </div>
        </div>
      </nav>

      {/* ═══════════════════════ MOBILE DRAWER ═══════════════════════ */}
      <div
        className={`w2-mobile-scrim${mobileNavOpen ? ' w2-mobile-scrim--open' : ''}`}
        aria-hidden="true"
        onClick={() => setMobileNavOpen(false)}
      />
      <aside
        id="w2-mobile-drawer"
        className={`w2-mobile-drawer${mobileNavOpen ? ' w2-mobile-drawer--open' : ''}`}
        aria-label="Mobile navigation"
        aria-hidden={!mobileNavOpen}
      >
        <div className="w2-mobile-drawer-head">
          <div className="w2-mobile-drawer-brand">
            <img src="/spectre-logo-dark.png" alt="" className="w2-mobile-drawer-logo" />
            <span className="w2-mobile-drawer-wordmark">Spectre<span className="w2-mobile-drawer-wordmark-ai">AI</span></span>
          </div>
          <button
            type="button"
            className="w2-mobile-drawer-close"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <span className="w2-mobile-drawer-eyebrow">Navigate</span>
        <nav className="w2-mobile-drawer-nav" aria-label="Sections">
          {NAV_LINKS.map((link, idx) => (
            <button
              key={link.id || link.href}
              type="button"
              className={`w2-mobile-drawer-link${activeSection === link.id ? ' w2-mobile-drawer-link--active' : ''}`}
              style={{ '--w2-drawer-stagger': `${idx * 32}ms` }}
              onClick={() => {
                setMobileNavOpen(false)
                if (link.href) { navigate(link.href) } else { setTimeout(() => scrollTo(link.id), 180) }
              }}
            >
              <span className="w2-mobile-drawer-link-icon" aria-hidden="true">
                {W2_DRAWER_ICONS[link.icon] || W2_DRAWER_ICONS.home}
              </span>
              <span className="w2-mobile-drawer-link-label">{link.label}</span>
              <svg className="w2-mobile-drawer-link-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ))}
          <BgMusicToggle />
        </nav>
        <div className="w2-mobile-drawer-foot">
          <button
            type="button"
            className="w2-mobile-drawer-cta w2-mobile-drawer-cta--primary"
            onClick={() => { setMobileNavOpen(false); navigate('/lp') }}
          >
            Open App
          </button>
          <a
            className="w2-mobile-drawer-cta w2-mobile-drawer-cta--accent"
            href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileNavOpen(false)}
          >
            Buy $SPECTRE
          </a>
        </div>
      </aside>

      {/* ═══════════════════════ HERO ═══════════════════════ */}
      <section className="w2-hero" id="home">
        <div className="w2-hero-frame">
          <div
            className="w2-hero-video-wrap"
            style={{
              '--hero-op-desktop': activeSlide.objectPositionDesktop || '50% 30%',
              '--hero-op-mobile': activeSlide.objectPositionMobile || '50% 40%',
            }}
          >
            {activeSlide.fullVideo && !hasStarted ? (
              <img src={activeSlide.poster || '/spectre-hero-poster.jpg'} alt="" className="w2-hero-video w2-hero-poster" />
            ) : HERO_SLIDES[heroSlide].type === 'video' ? (
              <video
                ref={videoRef}
                key={HERO_SLIDES[heroSlide].media + heroSlide}
                muted
                playsInline
                preload="auto"
                poster={HERO_SLIDES[heroSlide].poster || '/spectre-hero-poster.jpg'}
                className="w2-hero-video"
              >
                <source src={HERO_SLIDES[heroSlide].media} type="video/mp4" />
              </video>
            ) : (
              <img src={HERO_SLIDES[heroSlide].media} alt="" className="w2-hero-video" style={{ objectFit: 'cover' }} />
            )}
            <div className="w2-hero-video-overlay" />
            {/* Center play button inside video-wrap so it stays on the video,
                not the text content below on mobile. */}
            {activeSlide.fullVideo && !hasStarted && (
              <div className="w2-center-play" aria-hidden="true">
                <button
                  type="button"
                  className="w2-center-play-icon"
                  onClick={(e) => {
                    e.stopPropagation()
                    setHasStarted(true)
                    setIsMuted(false)
                    setIsPaused(false)
                  }}
                  aria-label="Play hero video"
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                </button>
              </div>
            )}
          </div>

          {/* Hero copy */}
          <div className="w2-hero-content">
            <h1 className="w2-hero-title">
              AI Market Intelligence
            </h1>
            <p className="w2-hero-sub">
              50,000 assets. 500 sources. Every chart, post and wallet read live, then written back to you in one sentence you can act on. Built by a desk, not a demo.
            </p>
            <div className="w2-hero-ctas">
              <button className="w2-btn-primary" onClick={() => navigate('/lp')}>
                Open App
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
              <button
                className="w2-btn-outline"
                onClick={() => {
                  setWaitlistOpen(true)
                  setSocialsOpen(false)
                  setWaitlistStatus('idle')
                }}
              >
                Join the Waitlist
              </button>
              <a className="w2-btn-outline w2-btn-outline--subtle" href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6" target="_blank" rel="noopener noreferrer">Buy $SPECTRE</a>
            </div>
          </div>

          {/* Video controls */}
          <div className="w2-video-controls">
            <button className="w2-control-btn" aria-label={isPaused ? 'Play video' : 'Pause video'} onClick={() => { const v = videoRef.current; if (v) { if (v.paused) { v.play(); setIsPaused(false) } else { v.pause(); setIsPaused(true) } } }}>
              {isPaused ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
              )}
            </button>
            <button className="w2-control-btn" aria-label={isMuted ? 'Unmute video' : 'Mute video'} onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setIsMuted(v.muted) } }}>
              {isMuted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
              )}
            </button>
          </div>

          {/* ── Right sidebar rail — stacked widgets (Waitlist + Community) ── */}
          <aside
            className={`w2-rail${waitlistOpen || socialsOpen ? ' w2-rail--open' : ' w2-rail--closed'}`}
            aria-label="Waitlist and community"
          >
            <div className="w2-rail-stack">
              {/* ─── Widget 1: Waitlist (top) ─── */}
              {!waitlistOpen ? (
                <button
                  type="button"
                  className="w2-rail-pill w2-rail-pill--waitlist"
                  onClick={(e) => { e.stopPropagation(); setWaitlistOpen(true); setWaitlistStatus('idle') }}
                  aria-label="Open waitlist"
                >
                  <span className="w2-rail-pill-dot w2-rail-pill-dot--cyan" />
                  <span className="w2-rail-pill-label">Join Waitlist</span>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              ) : (
                <div
                  className={`w2-rail-card w2-rail-card--waitlist${waitlistStatus === 'success' ? ' w2-rail-card--success' : ''}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="w2-rail-card-head">
                    <span className="w2-rail-card-eyebrow">
                      <span className="w2-rail-card-dot w2-rail-card-dot--cyan" />
                      Waitlist
                    </span>
                    <button
                      type="button"
                      className="w2-rail-card-close"
                      onClick={(e) => { e.stopPropagation(); setWaitlistOpen(false); setWaitlistStatus('idle') }}
                      aria-label="Collapse waitlist"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                    </button>
                  </div>

                  {waitlistStatus !== 'success' ? (
                    <>
                      <div className="w2-rail-card-counter">
                        <span className="w2-rail-card-counter-label">LIMITED SPOTS</span>
                        <span className="w2-rail-card-counter-num">100 / 100</span>
                      </div>
                      <h3 className="w2-rail-card-title">Get on the V2 waitlist.</h3>
                      <p className="w2-rail-card-sub">First 100 seats go to premium tier holders and waitlist members.</p>
                      <form className="w2-rail-form" onSubmit={(e) => submitWaitlist(e, 'website-rail')}>
                        <div className={`w2-rail-field${waitlistStatus === 'error' ? ' w2-rail-field--error' : ''}`}>
                          <svg className="w2-rail-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
                          <input
                            type="email"
                            className="w2-rail-input"
                            placeholder="your@email.com"
                            value={waitlistEmail}
                            onChange={(e) => { setWaitlistEmail(e.target.value); if (waitlistStatus === 'error') setWaitlistStatus('idle') }}
                            autoFocus
                            required
                          />
                        </div>
                        <div className="w2-rail-field">
                          <svg className="w2-rail-field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.5 4.5 2.5 12l6 2.5M21.5 4.5 18 20l-9.5-5.5M21.5 4.5 8.5 14.5l0 5 4-3.5" /></svg>
                          <input
                            type="text"
                            className="w2-rail-input"
                            placeholder="@telegram (optional)"
                            value={waitlistTelegram}
                            onChange={(e) => setWaitlistTelegram(e.target.value)}
                            autoComplete="off"
                            maxLength={64}
                          />
                        </div>
                        {/* Honeypot — hidden from users, visible to bots.
                            Any non-empty value makes the server drop silently. */}
                        <input
                          ref={waitlistHpRef}
                          type="text"
                          name="website"
                          tabIndex={-1}
                          autoComplete="off"
                          aria-hidden="true"
                          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                        />
                        <button type="submit" className="w2-rail-submit" disabled={waitlistStatus === 'submitting'}>
                          {waitlistStatus === 'submitting' ? 'Joining' : 'Request Access'}
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                        </button>
                        <div className="w2-rail-trust">
                          <span className="w2-rail-trust-dot" />
                          <span>$SPECTRE holders get access first</span>
                        </div>
                      </form>
                    </>
                  ) : (
                    <div className="w2-rail-success">
                      <div className="w2-rail-success-check">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      </div>
                      <h3 className="w2-rail-card-title">You&apos;re on the list.</h3>
                      <p className="w2-rail-card-sub">We&apos;ll reach out when Spectre opens to you.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Widget 2: Community (bottom) ─── */}
              {!socialsOpen ? (
                <button
                  type="button"
                  className="w2-rail-pill w2-rail-pill--community"
                  onClick={(e) => { e.stopPropagation(); setSocialsOpen(true) }}
                  aria-label="Open community"
                >
                  <span className="w2-rail-pill-dot" />
                  <span className="w2-rail-pill-num">30K+</span>
                  <span className="w2-rail-pill-label">Community</span>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              ) : (
                <div className="w2-rail-card w2-rail-card--community" onClick={(e) => e.stopPropagation()}>
                  <div className="w2-rail-card-head">
                    <span className="w2-rail-card-eyebrow">
                      <span className="w2-rail-card-dot w2-rail-card-dot--green" />
                      Community
                    </span>
                    <button
                      type="button"
                      className="w2-rail-card-close"
                      onClick={() => setSocialsOpen(false)}
                      aria-label="Collapse community"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  </div>
                  <div className="w2-rail-stat">
                    <span className="w2-rail-stat-num">30,000+</span>
                    <span className="w2-rail-stat-label">Members across five platforms</span>
                  </div>
                  <div className="w2-rail-channels">
                    <a href="https://x.com/Spectre__AI" target="_blank" rel="noopener noreferrer" className="w2-rail-ch">
                      <span className="w2-rail-ch-ic"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></span>
                      <span className="w2-rail-ch-name">X</span>
                      <span className="w2-rail-ch-num">22.9K</span>
                    </a>
                    <a href="https://telegram.me/AI_SPECTRE" target="_blank" rel="noopener noreferrer" className="w2-rail-ch">
                      <span className="w2-rail-ch-ic"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.492-1.302.48-.428-.012-1.252-.242-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg></span>
                      <span className="w2-rail-ch-name">Telegram</span>
                      <span className="w2-rail-ch-num">5.2K</span>
                    </a>
                    <a href="https://www.youtube.com/@ai-spectre" target="_blank" rel="noopener noreferrer" className="w2-rail-ch">
                      <span className="w2-rail-ch-ic w2-rail-ch-ic--yt"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></span>
                      <span className="w2-rail-ch-name">YouTube</span>
                      <span className="w2-rail-ch-num">1.8K</span>
                    </a>
                    <a href="https://www.linkedin.com/company/ai-spectre" target="_blank" rel="noopener noreferrer" className="w2-rail-ch">
                      <span className="w2-rail-ch-ic w2-rail-ch-ic--li"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></span>
                      <span className="w2-rail-ch-name">LinkedIn</span>
                      <span className="w2-rail-ch-num">3.4K</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* Hero tabs - each switches the hero visual */}
        <div className="w2-hero-slides" role="tablist">
          {HERO_SLIDES.map((slide, i) => (
            <button
              key={slide.label}
              className={`w2-hero-slide${heroSlide === i ? ' w2-hero-slide--active' : ''}`}
              aria-selected={heroSlide === i}
              role="tab"
              onClick={() => { setHeroSlide(i); setHasStarted(false) }}
            >
              <span className="w2-hero-slide-label">{slide.label}</span>
              <span className="w2-hero-slide-sub">{slide.sublabel}</span>
              {heroSlide === i && <span className="w2-hero-slide-bar" />}
            </button>
          ))}
        </div>

        {/* Scroll indicator */}
        <div className="w2-scroll-indicator" onClick={() => scrollTo('demo')}>
          <div className="w2-scroll-mouse">
            <div className="w2-scroll-dot" />
          </div>
          <span className="w2-scroll-label">Scroll</span>
        </div>
      </section>

      {/* ═══════════════════════ LIVE APP SHOWCASE ═══════════════════════ */}
      <section className="w2-showcase" id="demo">
        <div className="w2-showcase-header w2-reveal">
          <h2 className="w2-showcase-headline">Open the app.<br />See how it thinks.</h2>
          <p className="w2-showcase-lede">Test a preview. Beta out soon.</p>
        </div>
        <div className="w2-showcase-device w2-reveal">
          <div className="w2-showcase-glow" />
          <div className="w2-showcase-macbook">
            <div className="w2-showcase-bezel">
              <div className="w2-showcase-camera" />
              <div className="w2-showcase-screen">
                {/* Live iframe of the Spectre Terminal. Long-term this should
                    point at a public preview deployment (no Vercel deployment
                    protection); short-term we read VITE_SHOWCASE_BYPASS_TOKEN
                    so the token isn't committed to source. The previous token
                    that lived here in plaintext has been rotated. */}
                <iframe
                  className="w2-showcase-iframe"
                  src={(() => {
                    const base = 'https://app.spectreai.io/?embed=showcase&demo=true'
                    const token = import.meta.env.VITE_SHOWCASE_BYPASS_TOKEN
                    return token
                      ? `${base}&x-vercel-protection-bypass=${encodeURIComponent(token)}&x-vercel-set-bypass-cookie=true`
                      : base
                  })()}
                  title="Spectre Terminal live preview"
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  referrerPolicy="no-referrer"
                  aria-label="Spectre Terminal live preview — research zone and bubbles"
                />
                <span className="w2-showcase-badge" aria-hidden="true">
                  <span className="w2-showcase-badge-dot" />
                  LIVE
                </span>
                <a
                  className="w2-showcase-open"
                  href="https://app.spectreai.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the full Spectre app in a new tab"
                >
                  Open full app
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 17L17 7M17 7H7M17 7v10" />
                  </svg>
                </a>
              </div>
            </div>
            <div className="w2-showcase-lid"><div className="w2-showcase-hinge" /></div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ $SPECTRE TOKEN ═══════════════════════ */}
      <section className="w2-token" id="token">
        <div className="w2-token-inner">
          <div className="w2-token-header w2-reveal">
            <h2 className="w2-token-headline">$SPECTRE Tiers.<br /><span className="w2-display-dim">Own a piece of the platform.</span></h2>
          </div>

          <div className="w2-token-split w2-reveal">
            {/* LEFT — contract + buy CTA */}
            <div className="w2-token-left">
              <div className="w2-ca-card">
                <div className="w2-ca-top">
                  <div className="w2-ca-chip">
                    <svg width="14" height="22" viewBox="0 0 256 417" xmlns="http://www.w3.org/2000/svg">
                      <path fill="#F5F5F7" d="M127.9611 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" opacity="0.95"/>
                      <path fill="#F5F5F7" d="M127.962 0L0 212.32l127.962 75.639V154.158z" opacity="0.65"/>
                      <path fill="#F5F5F7" d="M127.9611 312.1866l-1.575 1.92v98.199l1.575 4.601L256 236.5866z" opacity="0.95"/>
                      <path fill="#F5F5F7" d="M127.962 416.9052v-104.72L0 236.585z" opacity="0.65"/>
                      <path fill="#F5F5F7" d="M127.9611 287.9577l127.96-75.637-127.96-58.162z" opacity="0.85"/>
                      <path fill="#F5F5F7" d="M0 212.3208l127.96 75.637v-133.799z" opacity="0.75"/>
                    </svg>
                    Ethereum
                  </div>
                  <div className="w2-ca-chip w2-ca-chip--muted">ERC-20</div>
                  <div className="w2-ca-chip w2-ca-chip--muted">10M supply</div>
                  <a
                    href="https://etherscan.io/token/0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w2-ca-chip w2-ca-chip--link"
                  >
                    Etherscan
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17L17 7M17 7H7M17 7v10" />
                    </svg>
                  </a>
                </div>

                <div className="w2-ca-label">Contract Address</div>

                <div className="w2-ca-hero">
                  <code className="w2-ca-hero-hash">0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6</code>
                  <button
                    type="button"
                    className={`w2-ca-hero-copy${caCopied ? ' w2-ca-hero-copy--done' : ''}`}
                    onClick={() => {
                      navigator.clipboard.writeText('0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6')
                      setCaCopied(true)
                      setTimeout(() => setCaCopied(false), 2000)
                    }}
                  >
                    {caCopied ? (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        Copied
                      </>
                    ) : (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              <a
                className="w2-token-buy"
                href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="w2-token-buy-inner">
                  <span className="w2-token-buy-text">
                    <span className="w2-token-buy-headline">Buy $SPECTRE on Uniswap</span>
                    <span className="w2-token-buy-sub">Access is tied to the wallet, not a billing cycle.</span>
                  </span>
                  <span className="w2-token-buy-arrow" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                  </span>
                </span>
              </a>

              <a
                className="w2-token-chart-link"
                href="https://dexscreener.com/ethereum/0x8a6d9525a0f07dcdc17fff15644342c314025a80"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 3v18h18"/>
                  <path d="m19 9-5 5-4-4-3 3"/>
                </svg>
                View live chart on Dexscreener
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 17L17 7M17 7H7M17 7v10"/>
                </svg>
              </a>

              {/* Why $SPECTRE — trust + benefit panel to balance the tall tier stack on the right */}
              <div className="w2-token-why">
                <div className="w2-token-why-head">
                  <span className="w2-token-why-kicker">Why hold $SPECTRE</span>
                  <h4 className="w2-token-why-title">What the token buys you.</h4>
                </div>
                <ul className="w2-token-why-list">
                  <li className="w2-token-why-row">
                    <span className="w2-token-why-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-11V4l-8-2-8 2v7c0 7 8 11 8 11z"/>
                        <path d="m9 12 2 2 4-4"/>
                      </svg>
                    </span>
                    <div className="w2-token-why-text">
                      <span className="w2-token-why-head-row">Audited contract, fixed supply.</span>
                      <span className="w2-token-why-sub">CertiK-reviewed, verified on Etherscan, 10M supply. Liquidity on Uniswap v3.</span>
                    </div>
                  </li>
                  <li className="w2-token-why-row">
                    <span className="w2-token-why-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m7 10 5 5 5-5"/>
                        <path d="M12 4v11"/>
                        <path d="M4 20h16"/>
                      </svg>
                    </span>
                    <div className="w2-token-why-text">
                      <span className="w2-token-why-head-row">Tiers are cumulative.</span>
                      <span className="w2-token-why-sub">Moving up means topping up to the next threshold. What you already hold counts toward it.</span>
                    </div>
                  </li>
                  <li className="w2-token-why-row">
                    <span className="w2-token-why-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                      </svg>
                    </span>
                    <div className="w2-token-why-text">
                      <span className="w2-token-why-head-row">Staking and revenue share are on the roadmap.</span>
                      <span className="w2-token-why-sub">Holders get first access to the upcoming staking program and a share of platform revenue as Spectre scales. Being early pays forward.</span>
                    </div>
                  </li>
                </ul>
                <div className="w2-token-why-foot">
                  <span className="w2-token-why-foot-dot" />
                  <span>Token-gated access to Spectre Terminal, Research Feed, Agents and the Intelligence Hub.</span>
                </div>
              </div>
            </div>

            {/* RIGHT — Big tier cards. Primary conversion column. */}
            <div className="w2-token-right">
              <div className="w2-tiers-head">
                <h3 className="w2-tiers-head-title">Pick your seat.</h3>
                <p className="w2-tiers-head-sub">Each tier unlocks more of the engine. Hold once, keep forever.</p>
              </div>
              <div className="w2-tier-stack">
                {TIERS.map((tier, i) => (
                  <a
                    key={tier.name}
                    className={`w2-tier-card w2-tier-card--${tier.name.toLowerCase()}`}
                    href="https://app.uniswap.org/explore/tokens/ethereum/0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="w2-tier-card-glow" aria-hidden="true" />
                    <div className="w2-tier-card-top">
                      <span className="w2-tier-card-name">{tier.name}</span>
                    </div>
                    <div className="w2-tier-card-amount">
                      <span className="w2-tier-card-amount-num">{tier.amount}</span>
                      <span className="w2-tier-card-amount-sym">$SPECTRE</span>
                    </div>
                    <p className="w2-tier-card-desc">{tier.desc}</p>
                    <div className="w2-tier-card-cta">
                      <span>Unlock {tier.name}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ BACKED BY — Partnership register ═══════════════════════ */}
      <section className="w2-backed" id="backed">
        <div className="w2-backed-hero w2-reveal">
          <h2 className="w2-backed-head">
            Backed by <span className="w2-backed-head-accent">Google for Startups</span>.<br />
            <span className="w2-backed-head-dim">$200,000 Scale Tier · TradingView Licence Agreement · NVIDIA for Startups Member.</span>
          </h2>
          <p className="w2-backed-sub">
            GPU compute, charting, cloud, on-chain data. Paid contracts, not a wall of logos. The receipts sit in our finance folder.
          </p>
        </div>

        {/* Four-up partner cards: accomplishment is the headline */}
        <div className="w2-backed-quad w2-reveal">
          {BACKED_BY.map((item) => (
            <a
              key={item.headline}
              href={`https://${item.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w2-backed-quad-card"
              style={{ '--card-brand': item.brand, '--card-glow': item.glow }}
            >
              <div className="w2-backed-quad-top">
                <div className="w2-backed-quad-logo">
                  <BackedLogo kind={item.logoKey} />
                </div>
                <span className="w2-backed-quad-chip">
                  {item.chip}
                </span>
              </div>
              <h3 className="w2-backed-quad-headline">{item.headline}</h3>
              <div className="w2-backed-quad-sub">{item.subhead}</div>
              <p className="w2-backed-quad-text">{item.detail}</p>
              <div className="w2-backed-quad-foot">
                <span className="w2-backed-quad-domain">{item.domain}</span>
                <span className="w2-backed-quad-btn" aria-hidden="true">
                  <span className="w2-backed-quad-btn-label">Visit</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
                </span>
              </div>
            </a>
          ))}
        </div>

        {/* CertiK audit — standalone horizontal strip. Sits on its own line
            below the four partner cards so the program-partner grid keeps its
            balanced 4-column composition. */}
        <a
          className="w2-audit-strip w2-reveal"
          href="https://skynet.certik.com/projects/spectre-ai"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="CertiK security audit and Web3 AI-Driven Innovator spotlight for Spectre AI"
        >
          <div className="w2-audit-strip-left">
            <div className="w2-audit-strip-shield" aria-hidden="true">
              <svg width="28" height="30" viewBox="0 0 32 34" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 1.5 2.5 6.2v10.3c0 8.3 5.8 13.7 13.5 16 7.7-2.3 13.5-7.7 13.5-16V6.2L16 1.5Z" fill="rgba(245,245,247,0.06)" stroke="rgba(245,245,247,0.65)" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="m10.5 16.5 4 4 7.5-8" stroke="#f5f5f7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="w2-audit-strip-copy">
              <div className="w2-audit-strip-kicker">
                Smart contract security
                <span className="w2-audit-strip-spotlight">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 2 2.6 6.2L21 9l-4.8 4.2L17.6 20 12 16.5 6.4 20l1.4-6.8L3 9l6.4-.8L12 2Z"/></svg>
                  Spotlight: Web3 AI-Driven Innovator
                </span>
              </div>
              <h3 className="w2-audit-strip-headline">
                Audited by <span className="w2-audit-strip-headline-brand">CertiK</span>.
              </h3>
              <p className="w2-audit-strip-detail">
                Reviewed by CertiK and featured on Skynet, rated A with High Security and High Governance. Source verified on-chain against a 10M fixed supply.
              </p>
            </div>
          </div>
          <div className="w2-audit-strip-right">
            <span className="w2-audit-strip-domain">skynet.certik.com</span>
            <span className="w2-audit-strip-btn" aria-hidden="true">
              View audit
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
            </span>
          </div>
        </a>
      </section>

      {/* ═══════════════════════ OUR PRODUCT MARKET FIT ═══════════════════════ */}
      <section className="w2-gap" id="gap">
        <div className="w2-gap-header w2-reveal">
          <p className="w2-tag">Our Product Market Fit</p>
          <h2 className="w2-display">
            Everyone chose a side.<br />
            <span className="w2-display-dim">We chose the middle.</span>
          </h2>
        </div>

        <div className="w2-gap-spectre w2-reveal">
          <img src="/spectre-logo-dark.png" alt="Spectre" className="w2-gap-logo" />
          <span className="w2-gap-name">Spectre</span>
          <span className="w2-gap-sub">Intelligence + Community</span>
          <svg className="w2-gap-arrow" width="20" height="56" viewBox="0 0 20 56" fill="none">
            <path d="M10 0 L10 42" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeDasharray="4 4" />
            <path d="M4 38 L10 50 L16 38" stroke="rgba(245,245,247,0.5)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="w2-gap-canvas w2-reveal">
          {/* Left - Community */}
          <div className="w2-gap-side">
            <div className="w2-gap-label">Community Lives Here</div>
            <div className="w2-gap-cluster">
              {[
                { name: 'X', logo: 'https://www.google.com/s2/favicons?domain=x.com&sz=128', size: 'xl' },
                { name: 'Telegram', logo: 'https://www.google.com/s2/favicons?domain=telegram.org&sz=128', size: 'xl' },
                { name: 'YouTube', logo: 'https://www.google.com/s2/favicons?domain=youtube.com&sz=128', size: 'lg' },
                { name: 'LinkedIn', logo: 'https://www.google.com/s2/favicons?domain=linkedin.com&sz=128', size: 'lg' },
                { name: 'Instagram', logo: 'https://www.google.com/s2/favicons?domain=instagram.com&sz=128', size: 'md' },
                { name: 'TikTok', logo: 'https://www.google.com/s2/favicons?domain=tiktok.com&sz=128', size: 'md' },
                { name: 'Medium', logo: 'https://www.google.com/s2/favicons?domain=medium.com&sz=128', size: 'sm' },
              ].map((item, i) => (
                <div key={item.name} className={`w2-gap-bubble w2-gap-bubble--warm w2-gap-bubble--${item.size}`} style={{ animationDelay: `${i * 0.6}s` }}>
                  <img src={item.logo} alt={item.name} className="w2-gap-bubble-logo" draggable="false" />
                  <span className="w2-gap-bubble-name">{item.name}</span>
                </div>
              ))}
            </div>
            <div className="w2-gap-verdict">Opinions. No data.</div>
          </div>

          {/* Center void */}
          <div className="w2-gap-void">
            <div className="w2-gap-void-border" />
            <div className="w2-gap-void-inner">
              <div className="w2-gap-void-text">Nobody is here</div>
              <div className="w2-gap-void-sub">Intelligence + Community</div>
            </div>
          </div>

          {/* Right - Data */}
          <div className="w2-gap-side">
            <div className="w2-gap-label">Data Lives Here</div>
            <div className="w2-gap-cluster w2-gap-cluster--right">
              {[
                { name: 'Nansen', logo: 'https://www.google.com/s2/favicons?domain=nansen.ai&sz=128', size: 'xl' },
                { name: 'DeFiLlama', logo: 'https://www.google.com/s2/favicons?domain=defillama.com&sz=128', size: 'xl' },
                { name: 'TradingView', logo: 'https://www.google.com/s2/favicons?domain=tradingview.com&sz=128', size: 'lg' },
                { name: 'DexScreener', logo: 'https://www.google.com/s2/favicons?domain=dexscreener.com&sz=128', size: 'lg' },
                { name: 'Dune', logo: 'https://www.google.com/s2/favicons?domain=dune.com&sz=128', size: 'md' },
                { name: 'Messari', logo: 'https://www.google.com/s2/favicons?domain=messari.io&sz=128', size: 'md' },
                { name: 'CMC', logo: 'https://www.google.com/s2/favicons?domain=coinmarketcap.com&sz=128', size: 'md' },
                { name: 'CoinGecko', logo: 'https://www.google.com/s2/favicons?domain=coingecko.com&sz=128', size: 'sm' },
                { name: 'Bloomberg', logo: 'https://www.google.com/s2/favicons?domain=bloomberg.com&sz=128', size: 'sm' },
              ].map((item, i) => (
                <div key={item.name} className={`w2-gap-bubble w2-gap-bubble--cool w2-gap-bubble--${item.size}`} style={{ animationDelay: `${i * 0.4}s` }}>
                  <img src={item.logo} alt={item.name} className="w2-gap-bubble-logo" draggable="false" />
                  <span className="w2-gap-bubble-name">{item.name}</span>
                </div>
              ))}
            </div>
            <div className="w2-gap-verdict">Data. No community.</div>
          </div>
        </div>

        <p className="w2-gap-closing w2-reveal">
          The community apps give you noise. The data apps give you numbers.<br />
          We built the layer in between, and then wrote it in plain English.
        </p>
      </section>

      {/* ═══════════════════════ VOICES — Press / Coverage ═══════════════════════ */}
      <section className="w2-voices-section" id="voices">
        <div className="w2-voices-inner w2-reveal">
          <div className="w2-voices-head">
            <div className="w2-voices-head-left">
              <span className="w2-voices-eyebrow">Press</span>
              <h2 className="w2-voices-headline">Mentioned by the biggest names in the space.</h2>
              <p className="w2-voices-note">
                <span className="w2-voices-note-dot" aria-hidden="true" />
                The clips below cover earlier builds. Updated walkthroughs land this quarter.
              </p>
            </div>
            <a href="https://www.youtube.com/@ai-spectre" target="_blank" rel="noopener noreferrer" className="w2-voices-more">
              <span>See all coverage</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
            </a>
          </div>
          <div className="w2-voices-grid">
            {[
              {
                videoId: 'TIED0adnrng',
                href: 'https://www.youtube.com/watch?v=TIED0adnrng',
                creator: 'Feature',
                quote: 'Live walkthrough of the Spectre intelligence stack.',
              },
              {
                videoId: 'Fh_VQhuAzfk',
                href: 'https://www.youtube.com/watch?v=Fh_VQhuAzfk',
                creator: 'Feature',
                quote: 'Inside the Monarch brief and research workflow.',
              },
              {
                videoId: 'GEpbs0KQehI',
                href: 'https://www.youtube.com/watch?v=GEpbs0KQehI&t=1744s',
                creator: 'Feature',
                quote: 'Deep dive on why operators are switching to Spectre.',
              },
            ].map((v, i) => (
              <a
                key={v.videoId}
                href={v.href}
                target="_blank"
                rel="noopener noreferrer"
                className="w2-voice-card"
              >
                <div className="w2-voice-card-thumb">
                  <img
                    src={`https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  <div className="w2-voice-card-thumb-overlay" aria-hidden="true" />
                  <span className="w2-voice-card-play" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" /></svg>
                  </span>
                </div>
                <div className="w2-voice-card-body">
                  <span className="w2-voice-card-idx">{String(i + 1).padStart(2, '0')}</span>
                  <p className="w2-voice-card-quote">{v.quote}</p>
                  <div className="w2-voice-card-foot">
                    <span className="w2-voice-card-creator">{v.creator}</span>
                    <span className="w2-voice-card-sep" />
                    <span className="w2-voice-card-source">
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/></svg>
                      YouTube
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ WHY SPECTRE ═══════════════════════ */}
      <section className="w2-why" id="why">
        <div className="w2-why-inner">
          <div className="w2-why-head w2-reveal">
            <h2 className="w2-why-headline">One intelligence layer for the assets, accounts, and chains that move the market.</h2>
            <p className="w2-why-lede">Built over two years by seven people who traded before they built software.</p>
          </div>

          <div className="w2-why-blocks">
            {WHY_BLOCKS.map((b, i) => (
              <div
                className={`w2-why-block w2-reveal w2-stagger-${i + 1}`}
                data-tone={b.tone}
                key={b.label}
              >
                <div className="w2-why-block-num">
                  {b.num}
                  {b.suffix && <span className="w2-why-block-suffix">{b.suffix}</span>}
                </div>
                <div className="w2-why-block-label">{b.label}</div>
              </div>
            ))}
          </div>

          <div className="w2-why-coverage w2-reveal">
            <span className="w2-why-coverage-label">Coverage</span>
            <span className="w2-why-coverage-rule" />
            <span className="w2-why-coverage-item">Crypto</span>
            <span className="w2-why-coverage-sep">·</span>
            <span className="w2-why-coverage-item">Stocks</span>
            <span className="w2-why-coverage-sep">·</span>
            <span className="w2-why-coverage-item">Commodities</span>
            <span className="w2-why-coverage-sep">·</span>
            <span className="w2-why-coverage-item">Macro</span>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ THE ATLAS - House facade (windows + door) ═══════════════════════ */}
      <section className="w2-atlas w2-atlas--facade" id="atlas">
        <div className="w2-atlas-header w2-reveal">
          <h2 className="w2-atlas-headline w2-atlas-headline--tight">
            {t('atlas.tileHeadline', 'The tools we are giving you to out perform the market.')}
          </h2>
        </div>

        {/* Flat tile grid — no roof, no door, no facade chrome */}
        <div className="w2-facade w2-reveal">
          <div className="w2-facade-grid" role="list" aria-label={t('atlas.tileLabel', 'Spectre surfaces')}>
            {ATLAS_TOOLS.map((tool, i) => (
              <div
                key={tool.label}
                role="listitem"
                className="w2-atlas-tile"
                style={{ '--tile-rgb': tool.accent.rgb, '--tile-i': i }}
              >
                <span className="w2-atlas-tile-label">
                  {t(`atlas.item.${tool.label}`, tool.label)}
                </span>
                <span className="w2-atlas-tile-glow" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>

      </section>

      {/* ═══════════════════════ FEATURE CANVAS ═══════════════════════ */}
      <FeatureCanvas />

      {/* ═══════════════════════ API SHOWCASE ═══════════════════════ */}
      <section className="w2-api-showcase" id="api">
        <div className="w2-api-showcase-header w2-reveal">
          <h2 className="w2-display">
            The data behind Spectre, through one API.
          </h2>
          <p className="w2-api-lede">
            Every screen in the terminal is driven by one internal API, available to Elite holders. Same data, same latency.
          </p>
        </div>

        <div className="w2-api-showcase-inner w2-reveal">
          {/* Left column: copy + stats + CTA */}
          <div className="w2-api-copy">
            <div className="w2-api-stats-row">
              <div className="w2-api-stat">
                <span className="w2-api-stat-val">500+</span>
                <span className="w2-api-stat-label">endpoints</span>
              </div>
              <span className="w2-api-stat-divider" />
              <div className="w2-api-stat">
                <span className="w2-api-stat-val">&lt;80ms</span>
                <span className="w2-api-stat-label">median latency</span>
              </div>
              <span className="w2-api-stat-divider" />
              <div className="w2-api-stat">
                <span className="w2-api-stat-val">99.9%</span>
                <span className="w2-api-stat-label">uptime target</span>
              </div>
            </div>

            <p className="w2-api-desc">
              REST and streaming. Rate-limits that scale with your tier. Same data surface that drives the Spectre terminal, priced in $SPECTRE and available to every token holder.
            </p>

            <div className="w2-api-cta-row">
              <a href="/website2/api" className="w2-api-btn w2-api-btn--primary">
                <span className="w2-api-btn-label">Explore API Docs</span>
                <span className="w2-api-btn-icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </span>
              </a>
              <button type="button" className="w2-api-btn w2-api-btn--ghost" disabled aria-disabled="true">
                <span className="w2-api-btn-dot" aria-hidden="true" />
                <span className="w2-api-btn-label">Get API Keys</span>
                <span className="w2-api-btn-chip">Coming soon</span>
              </button>
            </div>
          </div>

          {/* Right column: terminal */}
          <div className="w2-api-terminal">
            <div className="w2-api-win-bar">
              <div className="w2-api-win-dots">
                <span className="w2-api-win-dot w2-api-win-dot--red" />
                <span className="w2-api-win-dot w2-api-win-dot--yellow" />
                <span className="w2-api-win-dot w2-api-win-dot--green" />
              </div>
              <span className="w2-api-win-url">api.spectreai.io/v1/signals</span>
              <span className="w2-api-win-badge">
                <span className="w2-api-win-badge-dot" />
                live
              </span>
            </div>

            <div className="w2-api-code-panel">
              <div className="w2-api-line-nums">
                <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span>
              </div>
              <pre className="w2-api-pre">{`curl https://api.spectreai.io/v1/signals \\
  -H "Authorization: Bearer $SPECTRE_KEY" \\
  -d '{
    "asset": "SOL",
    "window": "1h",
    "type": "onchain+sentiment"
  }'`}<span className="w2-api-cursor w2-api-cursor--blink" /></pre>
            </div>

            <div className="w2-api-response-panel w2-api-response-panel--show">
              <div className="w2-api-response-header">
                <span className="w2-api-ok-badge" style={{ color: '#10B981' }}>200 OK</span>
                <span className="w2-api-ok-badge" style={{ color: 'rgba(245,245,247,0.35)' }}>62ms</span>
              </div>
              <pre className="w2-api-pre w2-api-pre--response">{`{
  "asset": "SOL",
  "score": 0.82,
  "bias": "long",
  "catalyst": "validator inflow + whale rotation"
}`}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ PRICING ═══════════════════════ */}
      <section className="w2-pricing" id="pricing">
        <div className="w2-pricing-bg" />
        <div className="w2-pricing-header w2-reveal">
          <h2 className="w2-pricing-headline">Access is gated by $SPECTRE through V1.</h2>
          <p className="w2-pricing-lede">Hold the tier threshold and access activates automatically. Monthly subscriptions open at V2.</p>
        </div>

        <div className="w2-pricing-toggle w2-reveal">
          <button
            className={`w2-pricing-toggle-btn${pricingMode === 'token' ? ' w2-pricing-toggle-btn--active' : ''}`}
            onClick={() => setPricingMode('token')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10h8M8 14h8" /></svg>
            $SPECTRE Token
          </button>
          <button
            className="w2-pricing-toggle-btn w2-pricing-toggle-btn--disabled"
            type="button"
            disabled
            aria-disabled="true"
            title="Subscriptions launch at V2"
          >
            Subscription
            <span className="w2-pricing-toggle-soon">Coming Soon</span>
          </button>
        </div>

        <div className="w2-pricing-grid w2-reveal">
          {PRICING_PLANS.map((plan, i) => (
            <div
              className={`w2-price-card w2-stagger-${i + 1}${plan.popular ? ' w2-price-card--popular' : ''}`}
              key={plan.name}
              style={{ '--card-accent': plan.accent, '--card-accent-border': plan.accentBorder }}
            >
              {plan.popular && <div className="w2-price-badge">Most Popular</div>}
              <div className="w2-price-card-glow" />
              <h3 className="w2-price-name">{plan.name}</h3>
              <div className="w2-price-amount">
                {pricingMode === 'subscription' ? (
                  <>
                    <span className="w2-price-value">{plan.subPrice}</span>
                    <span className="w2-price-period">{plan.subPeriod}</span>
                  </>
                ) : (
                  <>
                    <span className="w2-price-value">{plan.tokenAmount || 'Free'}</span>
                    {plan.tokenAmount && <span className="w2-price-period"> $SPECTRE</span>}
                  </>
                )}
              </div>
              <p className="w2-price-desc">{plan.desc}</p>
              <ul className="w2-price-features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className={`w2-price-cta${plan.popular ? ' w2-price-cta--popular' : ''}`}
                onClick={() => plan.name === 'Enterprise' ? window.open('mailto:hello@spectreai.io') : navigate('/')}
              >
                {plan.name === 'Free' ? 'Get Started' : plan.name === 'Enterprise' ? 'Contact Us' : 'Start Free Trial'}
              </button>
            </div>
          ))}
        </div>

        <p className="w2-pricing-note w2-reveal">
          Token holders get permanent access - no monthly fees. Hold the required amount and your tier activates automatically.
        </p>
      </section>

      {false && (
      <section className="w2-caps" id="caps">
        <div className="w2-caps-header w2-reveal">
          <h2 className="w2-caps-headline">{t('caps.title1', 'Signature capabilities.')}<br /><span className="w2-display-dim">{t('caps.title2', 'Live inside the platform.')}</span></h2>
          <p className="w2-caps-lede">
            {t('caps.lede', 'Four signature capabilities from the platform. Each one a live component, styled exactly how it ships inside Spectre.')}
          </p>
        </div>

        {/* Tab strip — switches between the 4 caps below */}
        <div className="w2-cap-tabs w2-reveal" role="tablist" aria-label="Signature capabilities">
          {[
            { num: '01', label: 'Fear & Greed', color: '#10B981' },
            { num: '02', label: 'Economic Calendar', color: '#6B9AE8' },
            { num: '03', label: 'Ventures', color: '#A78BFA' },
            { num: '04', label: 'Monarch AI', color: '#F5F5F7' },
          ].map((tab, i) => (
            <button
              key={tab.num}
              type="button"
              role="tab"
              aria-selected={activeCap === i}
              className={`w2-cap-tab${activeCap === i ? ' w2-cap-tab--active' : ''}`}
              style={{ '--cap-tab-color': tab.color }}
              onClick={() => setActiveCap(i)}
            >
              <span className="w2-cap-tab-num">{tab.num}</span>
              <span className="w2-cap-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ─── 01. FEAR & GREED ─── */}
        {activeCap === 0 && (
        <div className="w2-cap w2-cap--tab" style={{ '--cap-color': '#10B981' }}>
          <div className="w2-cap-copy">
            <div className="w2-cap-eyebrow">
              <span className="w2-cap-eyebrow-dot" />
              <span className="w2-cap-eyebrow-num">01 /</span>
              SENTIMENT &middot; LIVE
            </div>
            <h3 className="w2-cap-headline">Fear &amp; Greed,<br />with the why.</h3>
            <p className="w2-cap-desc">
              Not just a number on a gauge. Spectre pairs the index with a full market thesis, smart-money distribution, forward returns, and the tokens most correlated with the current sentiment regime.
            </p>
            <ul className="w2-cap-bullets">
              <li className="w2-cap-bullet"><span><strong>Live composite index</strong> blending social, derivatives, and on-chain flows</span></li>
              <li className="w2-cap-bullet"><span><strong>Smart money vs retail</strong> positioning, side by side</span></li>
              <li className="w2-cap-bullet"><span><strong>Forward returns</strong>, how the market usually moves from here</span></li>
            </ul>
            <button className="w2-cap-cta" type="button" onClick={() => navigate('/fear-greed')}>
              Open Fear &amp; Greed
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M17 7H7M17 7v10" />
              </svg>
            </button>
          </div>
          <div className="w2-cap-visual">
            <div className="w2-fg-card">
              <div className="w2-fg-head">
                <span className="w2-fg-title">Spectre Index &middot; 24h</span>
                <span className="w2-fg-live">
                  <span className="w2-fg-live-dot" />
                  Live
                </span>
              </div>
              <div className="w2-fg-gauge">
                <svg viewBox="0 0 400 220">
                  <defs>
                    <linearGradient id="w2-fg-grad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#EF4444" />
                      <stop offset="28%" stopColor="#F59E0B" />
                      <stop offset="52%" stopColor="#FCD34D" />
                      <stop offset="76%" stopColor="#84CC16" />
                      <stop offset="100%" stopColor="#10B981" />
                    </linearGradient>
                  </defs>
                  {/* Track */}
                  <path
                    d="M 40 180 A 160 160 0 0 1 360 180"
                    fill="none"
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="18"
                    strokeLinecap="round"
                  />
                  {/* Filled arc */}
                  <path
                    className="w2-fg-arc-fg"
                    d="M 40 180 A 160 160 0 0 1 360 180"
                    fill="none"
                    stroke="url(#w2-fg-grad)"
                    strokeWidth="18"
                    strokeLinecap="round"
                  />
                  {/* Tick marks */}
                  {[0, 25, 50, 75, 100].map((v) => {
                    const angle = Math.PI - (v / 100) * Math.PI
                    const x1 = 200 + Math.cos(angle) * 138
                    const y1 = 180 - Math.sin(angle) * 138
                    const x2 = 200 + Math.cos(angle) * 148
                    const y2 = 180 - Math.sin(angle) * 148
                    return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" />
                  })}
                  {/* Needle - rotates to 68/100 position */}
                  <g className="w2-fg-needle">
                    <line x1="200" y1="180" x2="200" y2="40" stroke="#f5f5f7" strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="200" cy="180" r="8" fill="#f5f5f7" />
                    <circle cx="200" cy="180" r="4" fill="#09090b" />
                  </g>
                </svg>
                <div className="w2-fg-center">
                  <span className="w2-fg-value">68</span>
                  <span className="w2-fg-label">Greed</span>
                </div>
              </div>
              <div className="w2-fg-stats">
                <div className="w2-fg-stat">
                  <span className="w2-fg-stat-label">Yesterday</span>
                  <span className="w2-fg-stat-val">61</span>
                </div>
                <div className="w2-fg-stat">
                  <span className="w2-fg-stat-label">7d avg</span>
                  <span className="w2-fg-stat-val">58</span>
                </div>
                <div className="w2-fg-stat">
                  <span className="w2-fg-stat-label">30d high</span>
                  <span className="w2-fg-stat-val w2-fg-stat-val--bull">74</span>
                </div>
                <div className="w2-fg-stat">
                  <span className="w2-fg-stat-label">30d low</span>
                  <span className="w2-fg-stat-val w2-fg-stat-val--bear">32</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ─── 02. ECONOMIC CALENDAR ─── */}
        {activeCap === 1 && (
        <div className="w2-cap w2-cap--tab" style={{ '--cap-color': '#6B9AE8' }}>
          <div className="w2-cap-copy">
            <div className="w2-cap-eyebrow">
              <span className="w2-cap-eyebrow-dot" />
              <span className="w2-cap-eyebrow-num">02 /</span>
              MACRO &middot; CALENDAR
            </div>
            <h3 className="w2-cap-headline">Every event.<br />Every impact.</h3>
            <p className="w2-cap-desc">
              657 events from 9 sources. FOMC, CPI, NFP, PCE, central banks, token unlocks, governance votes. 4-tier impact classification, critical, high, medium, low, so you see what actually moves BTC, not noise.
            </p>
            <ul className="w2-cap-bullets">
              <li className="w2-cap-bullet"><span><strong>4-tier impact filtering</strong>, critical events that move BTC 2-5%, down to noise you can hide</span></li>
              <li className="w2-cap-bullet"><span><strong>Forecast vs actual</strong> deltas with instant context from 9 sources</span></li>
              <li className="w2-cap-bullet"><span><strong>Global coverage</strong>, US, EU, UK, Japan, Australia, Canada, Switzerland in one strip</span></li>
            </ul>
            <button className="w2-cap-cta" type="button" onClick={() => navigate('/economic-calendar')}>
              Open Calendar
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M17 7H7M17 7v10" />
              </svg>
            </button>
          </div>
          <div className="w2-cap-visual">
            <div className="w2-cal-card">
              <div className="w2-cal-head">
                <span className="w2-cal-title">This Week &middot; All Tiers</span>
                <span className="w2-cal-week">Apr 14 to Apr 18</span>
              </div>
              <div className="w2-cal-strip">
                {[
                  { day: 'Mon', date: '14', today: true, events: [
                    { time: '08:30 ET', name: 'Core PPI', impact: 'critical' },
                    { time: '08:30 ET', name: 'PPI MoM', impact: 'critical' },
                    { time: '12:10 ET', name: 'FOMC Goolsbee', impact: 'high' },
                  ]},
                  { day: 'Tue', date: '15', events: [
                    { time: '08:30 ET', name: 'Retail Sales', impact: 'high' },
                    { time: '08:30 ET', name: 'Empire State', impact: 'med' },
                  ]},
                  { day: 'Wed', date: '16', events: [
                    { time: '08:30 ET', name: 'Housing Starts', impact: 'med' },
                    { time: '09:15 ET', name: 'Industrial Prod.', impact: 'low' },
                  ]},
                  { day: 'Thu', date: '17', events: [
                    { time: '07:45 ET', name: 'ECB Rate Decision', impact: 'critical' },
                    { time: '08:30 ET', name: 'Jobless Claims', impact: 'high' },
                    { time: '08:30 ET', name: 'Philly Fed', impact: 'med' },
                  ]},
                  { day: 'Fri', date: '18', events: [
                    { time: '', name: 'Good Friday', impact: 'low' },
                  ]},
                ].map((d) => (
                  <div key={d.date} className={`w2-cal-day${d.today ? ' w2-cal-day--today' : ''}`}>
                    <div className="w2-cal-day-head">
                      <span className="w2-cal-day-name">{d.day}</span>
                      <span className="w2-cal-day-date">{d.date}</span>
                    </div>
                    <div className="w2-cal-events">
                      {d.events.map((e, i) => (
                        <div key={i} className={`w2-cal-event w2-cal-event--${e.impact}`}>
                          <span className="w2-cal-event-time">{e.time}</span>
                          <span className="w2-cal-event-name">{e.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="w2-cal-legend">
                <span className="w2-cal-legend-item"><span className="w2-cal-legend-dot" style={{ '--dot-color': '#FF3B30' }} />Critical</span>
                <span className="w2-cal-legend-item"><span className="w2-cal-legend-dot" style={{ '--dot-color': '#EF4444' }} />High</span>
                <span className="w2-cal-legend-item"><span className="w2-cal-legend-dot" style={{ '--dot-color': '#F59E0B' }} />Medium</span>
                <span className="w2-cal-legend-item"><span className="w2-cal-legend-dot" style={{ '--dot-color': '#6B7280' }} />Low</span>
              </div>
            </div>
          </div>
        </div>

        )}

        {/* ─── 03. VENTURES ─── */}
        {activeCap === 2 && (
        <div className="w2-cap w2-cap--tab" style={{ '--cap-color': '#A78BFA' }}>
          <div className="w2-cap-copy">
            <div className="w2-cap-eyebrow">
              <span className="w2-cap-eyebrow-dot" />
              <span className="w2-cap-eyebrow-num">03 /</span>
              PRIVATE MARKETS
            </div>
            <h3 className="w2-cap-headline">Find alpha<br />before the ticker.</h3>
            <p className="w2-cap-desc">
              Spectre Ventures tracks every meaningful VC round in crypto, seed through Series C, launched and unlaunched, with backer pedigree, round size, and a proprietary Spectre Score on every deal.
            </p>
            <ul className="w2-cap-bullets">
              <li className="w2-cap-bullet"><span><strong>Every deal, daily</strong>, raises under $1M to mega-rounds</span></li>
              <li className="w2-cap-bullet"><span><strong>Spectre Score</strong>, team, backers, traction, on-chain signals</span></li>
              <li className="w2-cap-bullet"><span><strong>Launch tracker</strong>, be first when the token goes live</span></li>
            </ul>
            <button className="w2-cap-cta" type="button" onClick={() => navigate('/ventures')}>
              Explore Ventures
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M17 7H7M17 7v10" />
              </svg>
            </button>
          </div>
          <div className="w2-cap-visual">
            <div className="w2-ven-stack">
              {[
                { name: 'Monad', logo: 'M', stage: 'Series A', raise: '$225M', backers: 'Paradigm · Dragonfly · Coinbase Ventures', score: 94, color: '#10B981', featured: true },
                { name: 'Berachain', logo: 'B', stage: 'Series B', raise: '$100M', backers: 'Framework · Polychain', score: 89, color: '#10B981' },
                { name: 'Story', logo: 'S', stage: 'Series B', raise: '$80M', backers: 'a16z crypto · Polychain', score: 86, color: '#F59E0B' },
                { name: 'Eclipse', logo: 'E', stage: 'Seed', raise: '$50M', backers: 'Placeholder · Polychain', score: 78, color: '#F59E0B' },
              ].map((deal, i) => {
                const circumference = 2 * Math.PI * 23
                const offset = circumference * (1 - deal.score / 100)
                return (
                  <div key={deal.name} className={`w2-ven-card${deal.featured ? ' w2-ven-card--featured' : ''}`}>
                    <div className="w2-ven-logo">
                      <span className="w2-ven-logo-text">{deal.logo}</span>
                    </div>
                    <div className="w2-ven-info">
                      <div className="w2-ven-name-row">
                        <span className="w2-ven-name">{deal.name}</span>
                        <span className="w2-ven-stage">{deal.stage}</span>
                      </div>
                      <div className="w2-ven-meta">
                        <span className="w2-ven-raise">{deal.raise}</span>
                        <span className="w2-ven-meta-sep" />
                        <span className="w2-ven-backers">{deal.backers}</span>
                      </div>
                    </div>
                    <div className="w2-ven-score" style={{ '--score-color': deal.color, '--score-len': circumference, '--score-offset': offset }}>
                      <svg viewBox="0 0 52 52">
                        <circle cx="26" cy="26" r="23" className="w2-ven-score-track" />
                        <circle cx="26" cy="26" r="23" className="w2-ven-score-fill" />
                      </svg>
                      <span className="w2-ven-score-num">{deal.score}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        )}

        {/* ─── 04. MONARCH AI ─── */}
        {activeCap === 3 && (
        <div className="w2-cap w2-cap--tab" style={{ '--cap-color': '#F5F5F7' }}>
          <div className="w2-cap-copy">
            <div className="w2-cap-eyebrow">
              <span className="w2-cap-eyebrow-dot" />
              <span className="w2-cap-eyebrow-num">04 /</span>
              MONARCH &middot; AI COPILOT
            </div>
            <h3 className="w2-cap-headline">Ask in any language.<br />Get research.</h3>
            <p className="w2-cap-desc">
              Monarch is the research agent built on top of the full Spectre data layer. Ask any question about any asset, any narrative, any flow, it streams back with citations from the sources you already trust.
            </p>
            <ul className="w2-cap-bullets">
              <li className="w2-cap-bullet"><span><strong>Full-context awareness</strong>, knows what you&apos;re looking at</span></li>
              <li className="w2-cap-bullet"><span><strong>Cited responses</strong>, every claim links to the data source</span></li>
              <li className="w2-cap-bullet"><span><strong>Streamed output</strong>, reads back in real time in any language, not just English</span></li>
            </ul>
            <button className="w2-cap-cta" type="button" onClick={() => navigate('/monarch-chat')}>
              Chat with Monarch
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M17 7H7M17 7v10" />
              </svg>
            </button>
          </div>
          <div className="w2-cap-visual">
            <div className="w2-mon-card">
              <div className="w2-mon-head">
                <div className="w2-mon-avatar" />
                <div>
                  <div className="w2-mon-name">Monarch</div>
                  <div className="w2-mon-status">
                    <span className="w2-mon-status-dot" />
                    Online &middot; Full context
                  </div>
                </div>
                <div className="w2-mon-head-spacer" />
                <div className="w2-mon-menu"><span /><span /><span /></div>
              </div>
              <div className="w2-mon-body">
                <div className="w2-mon-msg w2-mon-msg--user">
                  <div className="w2-mon-msg-avatar">You</div>
                  <div className="w2-mon-bubble">Is SOL overvalued vs ETH right now?</div>
                </div>
                <div className="w2-mon-msg w2-mon-msg--ai">
                  <div className="w2-mon-msg-avatar">S</div>
                  <div>
                    <div className="w2-mon-bubble">
                      SOL/ETH sits at <strong>0.062</strong>, 18% above its 90-day mean. On revenue multiples, Solana trades at <strong>28&times; annualized fees</strong> vs Ethereum&apos;s <strong>19&times;</strong>. Active users and fee capture still favor SOL, but the ratio is stretched. Historically, a mean reversion follows within 14 days when it passes 0.058<span className="w2-mon-bubble-cursor" />
                    </div>
                    <div className="w2-mon-sources">
                      <span className="w2-mon-source"><span className="w2-mon-source-dot" style={{ '--src-color': '#6B9AE8' }} />Codex</span>
                      <span className="w2-mon-source"><span className="w2-mon-source-dot" style={{ '--src-color': '#10B981' }} />Binance</span>
                      <span className="w2-mon-source"><span className="w2-mon-source-dot" style={{ '--src-color': '#F59E0B' }} />DeFiLlama</span>
                      <span className="w2-mon-source"><span className="w2-mon-source-dot" style={{ '--src-color': '#A78BFA' }} />Artemis</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="w2-mon-input">
                <div className="w2-mon-input-field">Ask Monarch anything&hellip;</div>
                <span className="w2-mon-input-kbd">&#8984;K</span>
                <div className="w2-mon-input-send">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}
      </section>
      )}

      {/* ═══════════════════════ ARCHITECTURE — n8n-style internal pipeline ═══════════════════════ */}
      <section className="w2-arch w2-arch-v2">
        <div className="w2-section-glow w2-section-glow--warm" />
        <div className="w2-arch-header w2-reveal">
          <h2 className="w2-arch-headline">
            {t('arch.title1', 'How a query')}
            <br />
            <span className="w2-display-dim">{t('arch.title2', 'runs.')}</span>
          </h2>
          <p className="w2-arch-lede">{t('arch.lede', 'Four feeds land in one engine. That engine drives every screen in the product. No third-party layer sits between you and the data.')}</p>
        </div>

        <div className="w2-arch-canvas w2-reveal" aria-hidden="false">
          {/* Animated SVG connectors */}
          <svg className="w2-arch-wires" viewBox="0 0 1200 520" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="wireGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.1" />
                <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
              </linearGradient>
              <filter id="wireGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" />
              </filter>
            </defs>
            {/* Ingest -> Process wires (from col 1 to col 2) */}
            {[90, 200, 310, 420].map((y, i) => (
              <g key={`w1-${i}`}>
                <path d={`M 240 ${y} C 340 ${y}, 380 260, 500 260`} stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
                <path d={`M 240 ${y} C 340 ${y}, 380 260, 500 260`} stroke="url(#wireGrad)" strokeWidth="1.5" fill="none" strokeDasharray="6 140" className="w2-arch-wire-dash" style={{ animationDelay: `${i * 0.6}s` }} filter="url(#wireGlow)" />
              </g>
            ))}
            {/* Process -> Output wires (from col 2 to col 3) */}
            {[60, 160, 260, 360, 460].map((y, i) => (
              <g key={`w2-${i}`}>
                <path d={`M 700 260 C 820 260, 860 ${y}, 960 ${y}`} stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
                <path d={`M 700 260 C 820 260, 860 ${y}, 960 ${y}`} stroke="url(#wireGrad)" strokeWidth="1.5" fill="none" strokeDasharray="6 140" className="w2-arch-wire-dash" style={{ animationDelay: `${0.3 + i * 0.5}s` }} filter="url(#wireGlow)" />
              </g>
            ))}
          </svg>

          {/* Column 1: Signal Ingest */}
          <div className="w2-arch-stage w2-arch-stage--in">
            <div className="w2-arch-stage-head">
              <span className="w2-arch-stage-title">{t('arch.stage1', 'What we pull in')}</span>
            </div>
            {[
              { label: 'Market Stream', sub: 'Spot · Derivs · RWA', dot: '#22d3ee' },
              { label: 'Social Graph', sub: '47K curated accounts', dot: '#8b5cf6' },
              { label: 'On-Chain', sub: 'Every major chain', dot: '#f59e0b' },
              { label: 'News & Docs', sub: 'Editorial + filings', dot: '#10b981' },
            ].map((n) => (
              <div key={n.label} className="w2-arch-node">
                <span className="w2-arch-node-icon" style={{ background: `radial-gradient(circle, ${n.dot} 0%, transparent 70%)` }} />
                <div className="w2-arch-node-body">
                  <div className="w2-arch-node-label">{t(`arch.ingest.${n.label}.label`, n.label)}</div>
                  <div className="w2-arch-node-sub">{t(`arch.ingest.${n.label}.sub`, n.sub)}</div>
                </div>
                <span className="w2-arch-node-port" />
              </div>
            ))}
          </div>

          {/* Column 2: Processing core */}
          <div className="w2-arch-stage w2-arch-stage--core">
            <div className="w2-arch-stage-head">
              <span className="w2-arch-stage-title">{t('arch.stage2', 'What we run on it')}</span>
            </div>
            <div className="w2-arch-core">
              <div className="w2-arch-core-rings" aria-hidden="true">
                <span /><span /><span />
              </div>
              <img src="/spectre-logo-dark.png" alt="Spectre" className="w2-arch-core-logo" />
              <div className="w2-arch-core-name">Monarch</div>
              <div className="w2-arch-core-sub">{t('arch.core.sub', 'Intelligence Engine')}</div>
              <div className="w2-arch-core-chips">
                <span className="w2-arch-core-chip">Embed</span>
                <span className="w2-arch-core-chip">Rank</span>
                <span className="w2-arch-core-chip">Cite</span>
                <span className="w2-arch-core-chip">Stream</span>
              </div>
            </div>
          </div>

          {/* Column 3: Delivery surfaces */}
          <div className="w2-arch-stage w2-arch-stage--out">
            <div className="w2-arch-stage-head">
              <span className="w2-arch-stage-title">{t('arch.stage3', 'What you see')}</span>
            </div>
            {[
              { label: 'Command Center', sub: '90-second read', dot: '#6b9ae8' },
              { label: 'Research Zone', sub: 'Deep theses', dot: '#10b981' },
              { label: 'Bubbles & Maps', sub: 'Market structure', dot: '#f59e0b' },
              { label: 'Monarch Chat', sub: 'Cited answers', dot: '#a78bfa' },
              { label: 'Alerts', sub: 'Push · Email · API', dot: '#ec4899' },
            ].map((n) => (
              <div key={n.label} className="w2-arch-node">
                <span className="w2-arch-node-port" />
                <span className="w2-arch-node-icon" style={{ background: `radial-gradient(circle, ${n.dot} 0%, transparent 70%)` }} />
                <div className="w2-arch-node-body">
                  <div className="w2-arch-node-label">{t(`arch.surface.${n.label}.label`, n.label)}</div>
                  <div className="w2-arch-node-sub">{t(`arch.surface.${n.label}.sub`, n.sub)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="w2-arch-footer w2-reveal">
          <span className="w2-arch-footer-dot" />
          <span>{t('arch.footer', 'No external APIs exposed. Every step runs inside Spectre.')}</span>
        </div>
      </section>

      {/* ═══════════════════════ ROADMAP ═══════════════════════ */}
      <section className="w2-roadmap" id="roadmap">
        <div className="w2-rm-hero w2-reveal">
          <h2 className="w2-display">Roadmap through 2028.</h2>
          <p className="w2-rm-lede">
            Every milestone is pinned to a quarter and backed by an internal document. If something slips, the timeline updates with the reason.
          </p>
          <div className="w2-rm-stat-row">
            <div className="w2-rm-stat">
              <span className="w2-rm-stat-val">2026 → 2028</span>
              <span className="w2-rm-stat-label">horizon</span>
            </div>
            <span className="w2-rm-stat-divider" />
            <div className="w2-rm-stat">
              <span className="w2-rm-stat-val">7</span>
              <span className="w2-rm-stat-label">milestones on the timeline</span>
            </div>
            <span className="w2-rm-stat-divider" />
            <div className="w2-rm-stat">
              <span className="w2-rm-stat-val w2-rm-stat-val--soon">Beta soon</span>
              <span className="w2-rm-stat-label">research platform, final checks</span>
            </div>
          </div>
        </div>

        <div className="w2-timeline" ref={timelineRef}>
          <svg className="w2-timeline-wire" viewBox="0 0 400 1400" preserveAspectRatio="none">
            <defs>
              <linearGradient id="w2-wire-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(107,154,232,0.6)" />
                <stop offset="60%" stopColor="rgba(107,154,232,0.3)" />
                <stop offset="100%" stopColor="rgba(107,154,232,0.08)" />
              </linearGradient>
            </defs>
            <path
              className="w2-wire-glow"
              d="M200,0 C80,100 320,200 200,300 C80,400 320,500 200,600 C80,700 320,800 200,900 C80,1000 320,1100 200,1200 L200,1400"
              style={{ strokeDasharray: wirePathLength, strokeDashoffset: wirePathLength * (1 - wireProgress) }}
            />
            <path
              ref={wirePathRef}
              className="w2-wire-path"
              d="M200,0 C80,100 320,200 200,300 C80,400 320,500 200,600 C80,700 320,800 200,900 C80,1000 320,1100 200,1200 L200,1400"
              style={{ strokeDasharray: wirePathLength, strokeDashoffset: wirePathLength * (1 - wireProgress) }}
            />
          </svg>

          {ROADMAP.map((item, i) => {
            const side = i % 2 === 0 ? 'w2-timeline-left' : 'w2-timeline-right'
            const active = item.status === 'active' ? ' w2-timeline-item--active' : ''
            const dotReached = wireProgress > (i / ROADMAP.length) ? ' w2-timeline-dot--reached' : ''
            return (
              <div className={`w2-timeline-item ${side}${active} w2-reveal w2-stagger-${Math.min(i + 1, 5)}`} key={item.date}>
                <div className={`w2-timeline-dot${item.status === 'active' ? ' w2-timeline-dot--active' : ''}${dotReached}`} />
                <div className="w2-timeline-card">
                  <span className="w2-timeline-quarter">{item.date}</span>
                  <h3 className="w2-timeline-title">{item.title}</h3>
                  <p className="w2-timeline-desc">{item.desc}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Key milestones */}
        <div className="w2-rm-milestones w2-reveal">
          <h3 className="w2-rm-milestones-label">Key Milestones</h3>
          <div className="w2-rm-milestones-track">
            {ROADMAP_EVENTS.map((ev) => (
              <div className={`w2-rm-milestone${ev.done ? ' w2-rm-milestone--done' : ''}`} key={ev.label}>
                <div className={`w2-rm-milestone-pip${ev.done ? ' w2-rm-milestone-pip--done' : ''}`} />
                <span className="w2-rm-milestone-name">{ev.label}</span>
                <span className="w2-rm-milestone-date">{ev.date}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Document links */}
        <div className="w2-rm-docs w2-reveal">
          {DOC_LINKS.map((doc) => (
            <a className="w2-rm-doc" href={doc.href} key={doc.label} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={doc.icon} />
              </svg>
              <span>{doc.label}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w2-rm-doc-arrow">
                <path d="M7 17L17 7M17 7H7M17 7v10" />
              </svg>
            </a>
          ))}
        </div>
      </section>

      {/* ═══════════════════════ SOCIAL INTELLIGENCE ═══════════════════════ */}
      <section className="w2-social-intel" id="social-intel">
        <div className="w2-si-vignette" />
        {/* Ambient neural web background - like X Intelligence app */}
        <canvas className="w2-si-canvas" ref={(el) => {
          if (!el || el._init) return
          el._init = true
          const ctx = el.getContext('2d')
          const dpr = window.devicePixelRatio || 1
          let w, h, raf, time = 0

          const nodes = Array.from({ length: 90 }, () => ({
            x: 0, y: 0, ox: Math.random(), oy: Math.random(),
            vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
            r: 1 + Math.random() * 3, phase: Math.random() * Math.PI * 2,
          }))

          function resize() {
            w = el.parentElement.offsetWidth
            h = el.parentElement.offsetHeight
            el.width = w * dpr; el.height = h * dpr
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            nodes.forEach(n => { n.x = n.ox * w; n.y = n.oy * h })
          }
          resize()

          function draw() {
            time += 0.006
            ctx.clearRect(0, 0, w, h)
            nodes.forEach(n => {
              n.x += n.vx; n.y += n.vy
              if (n.x < 0 || n.x > w) n.vx *= -1
              if (n.y < 0 || n.y > h) n.vy *= -1
            })
            // connections
            for (let i = 0; i < nodes.length; i++) {
              for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
                const dist = Math.sqrt(dx * dx + dy * dy)
                if (dist < 180) {
                  const alpha = (1 - dist / 180) * 0.12
                  ctx.strokeStyle = `rgba(200, 215, 240, ${alpha})`
                  ctx.lineWidth = 0.5
                  ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke()
                }
              }
            }
            // dots
            nodes.forEach(n => {
              const pulse = 0.4 + Math.sin(time * 2 + n.phase) * 0.15
              ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
              ctx.fillStyle = `rgba(220, 230, 245, ${pulse})`; ctx.fill()
            })
            raf = requestAnimationFrame(draw)
          }
          draw()
          const ro = new ResizeObserver(resize); ro.observe(el.parentElement)
          el._cleanup = () => { cancelAnimationFrame(raf); ro.disconnect() }
        }} />

        <div className="w2-si-content">
          {/* Header */}
          <div className="w2-si-header w2-reveal">
            <h2 className="w2-display">The accounts moving price show up before the candle does.</h2>
            <p className="w2-si-sub">
              We track 47,000 accounts and 2.3M relationships between them. The graph separates paid promotion from real conviction in under two seconds.
            </p>
          </div>

          {/* Metric rail */}
          <div className="w2-si-rail w2-reveal">
            <div className="w2-si-metric">
              <span className="w2-si-metric-value">47,000</span>
              <span className="w2-si-metric-label">Influencers tracked</span>
            </div>
            <span className="w2-si-metric-divider" />
            <div className="w2-si-metric">
              <span className="w2-si-metric-value">2.3M</span>
              <span className="w2-si-metric-label">Connections mapped</span>
            </div>
            <span className="w2-si-metric-divider" />
            <div className="w2-si-metric">
              <span className="w2-si-metric-value">&lt; 2s</span>
              <span className="w2-si-metric-label">Signal latency</span>
            </div>
            <span className="w2-si-metric-divider" />
            <div className="w2-si-metric">
              <span className="w2-si-metric-value">118K</span>
              <span className="w2-si-metric-label">Posts / day</span>
            </div>
          </div>

          {/* Mock UI Preview - app window showing X Intelligence interface */}
          <div className="w2-si-window w2-reveal">
            {/* Window chrome */}
            <div className="w2-si-chrome">
              <div className="w2-si-dots">
                <span className="w2-si-dot" style={{ background: '#ff5f57' }} />
                <span className="w2-si-dot" style={{ background: '#febc2e' }} />
                <span className="w2-si-dot" style={{ background: '#28c840' }} />
              </div>
              <div className="w2-si-chrome-title">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <span>spectreai.io</span>
              </div>
              <div className="w2-si-chrome-live">
                <span className="w2-si-chrome-dot" />
                LIVE
              </div>
            </div>

            {/* Tab row */}
            <div className="w2-si-tabs">
              <button className="w2-si-tab w2-si-tab--active" type="button">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                Influence
              </button>
              <button className="w2-si-tab" type="button">Mentions</button>
              <button className="w2-si-tab" type="button">Sentiment</button>
              <button className="w2-si-tab" type="button">Networks</button>
              <div className="w2-si-tab-spacer" />
              <div className="w2-si-search">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <span>Search any project, token, or voice</span>
                <span className="w2-si-kbd">⌘K</span>
              </div>
            </div>

            <div className="w2-si-panels">
              {/* Left panel - Most mentioned */}
              <div className="w2-si-panel">
                <div className="w2-si-panel-header">
                  <span className="w2-si-panel-title">Top Mentions</span>
                  <span className="w2-si-panel-period">Last 24h</span>
                </div>
                <div className="w2-si-mentioned-list">
                  {[
                    { rank: 1, name: 'Ethereum', symbol: 'ETH', mentions: '2,847', change: '+12%', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', bars: [0.3, 0.38, 0.45, 0.4, 0.55, 0.7, 0.82, 0.95] },
                    { rank: 2, name: 'Solana', symbol: 'SOL', mentions: '2,103', change: '+34%', logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png', bars: [0.2, 0.28, 0.35, 0.5, 0.62, 0.78, 0.88, 1] },
                    { rank: 3, name: 'Bitcoin', symbol: 'BTC', mentions: '1,924', change: '+5%', logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', bars: [0.55, 0.6, 0.52, 0.58, 0.62, 0.65, 0.7, 0.68] },
                    { rank: 4, name: 'Arbitrum', symbol: 'ARB', mentions: '1,205', change: '+89%', logo: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg', bars: [0.12, 0.15, 0.22, 0.3, 0.5, 0.72, 0.88, 1] },
                    { rank: 5, name: 'Base', symbol: 'BASE', mentions: '967', change: '+22%', logo: 'https://assets.coingecko.com/asset_platforms/images/131/small/base.jpeg', bars: [0.3, 0.35, 0.42, 0.5, 0.55, 0.6, 0.72, 0.85] },
                  ].map(t => (
                    <div className="w2-si-token-row" key={t.rank}>
                      <span className="w2-si-token-rank">0{t.rank}</span>
                      <img className="w2-si-token-logo" src={t.logo} alt={t.name} onError={(e) => { e.target.style.display = 'none' }} />
                      <div className="w2-si-token-info">
                        <span className="w2-si-token-name">{t.name}</span>
                        <span className="w2-si-token-symbol">${t.symbol}</span>
                      </div>
                      <div className="w2-si-token-spark" aria-hidden="true">
                        {t.bars.map((h, i) => (
                          <span key={i} className="w2-si-spark-bar" style={{ height: `${Math.max(h * 100, 8)}%` }} />
                        ))}
                      </div>
                      <div className="w2-si-token-mentions">
                        <span className="w2-si-token-count">{t.mentions}</span>
                        <span className="w2-si-token-change">{t.change}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right panel - Signal Leaders */}
              <div className="w2-si-panel">
                <div className="w2-si-panel-header">
                  <span className="w2-si-panel-title">Signal Leaders</span>
                  <span className="w2-si-panel-period">7d · By impact</span>
                </div>
                <div className="w2-si-kols-list">
                  {[
                    { name: 'CryptoNova', handle: '@cryptonova', score: 94, followers: '892K', initials: 'CN', ring: '#A78BFA', bg: 'linear-gradient(135deg, #A78BFA 0%, #7C3AED 100%)' },
                    { name: 'DefiWhale', handle: '@defiwhale', score: 91, followers: '1.2M', initials: 'DW', ring: '#06B6D4', bg: 'linear-gradient(135deg, #22D3EE 0%, #0891B2 100%)' },
                    { name: 'AlphaSeeker', handle: '@alphaseeker', score: 88, followers: '654K', initials: 'AS', ring: '#10B981', bg: 'linear-gradient(135deg, #34D399 0%, #059669 100%)' },
                    { name: 'MacroEdge', handle: '@macroedge', score: 85, followers: '445K', initials: 'ME', ring: '#F59E0B', bg: 'linear-gradient(135deg, #FBBF24 0%, #D97706 100%)' },
                  ].map(k => (
                    <div className="w2-si-kol-row" key={k.handle}>
                      <div
                        className="w2-si-kol-avatar w2-si-kol-avatar--initials"
                        style={{ borderColor: `${k.ring}60`, backgroundImage: k.bg }}
                        aria-label={k.name}
                      >
                        <span className="w2-si-kol-initials">{k.initials}</span>
                        <span className="w2-si-kol-online" style={{ background: k.ring, boxShadow: `0 0 6px ${k.ring}80` }} />
                      </div>
                      <div className="w2-si-kol-info">
                        <span className="w2-si-kol-name">{k.name}</span>
                        <span className="w2-si-kol-handle">{k.handle} · {k.followers}</span>
                      </div>
                      <div className="w2-si-kol-score">
                        <span className="w2-si-kol-score-num">{k.score}</span>
                        <svg viewBox="0 0 36 36" className="w2-si-kol-ring" style={{ '--ring-color': k.ring, '--ring-pct': `${k.score}` }}>
                          <circle cx="18" cy="18" r="16" />
                          <circle cx="18" cy="18" r="16" className="w2-si-kol-ring-fill" />
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Live ticker */}
            <div className="w2-si-ticker">
              <span className="w2-si-ticker-label">
                <span className="w2-si-ticker-pulse" />
                LIVE FEED
              </span>
              <div className="w2-si-ticker-track">
                <span className="w2-si-ticker-item"><span className="w2-si-ticker-dot" style={{ background: '#10B981' }} />@cryptonova accumulated SOL · 892 engagements</span>
                <span className="w2-si-ticker-item"><span className="w2-si-ticker-dot" style={{ background: '#06B6D4' }} />@defiwhale posted ARB thesis · trending</span>
                <span className="w2-si-ticker-item"><span className="w2-si-ticker-dot" style={{ background: '#F59E0B' }} />Narrative detected · "RWA Season"</span>
                <span className="w2-si-ticker-item"><span className="w2-si-ticker-dot" style={{ background: '#EC4899' }} />@alphaseeker · ETH breakout alert</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ LIVE FROM @SPECTRE__AI ═══════════════════════ */}
      {w2Tweets.length > 0 && (
        <section className="w2-feed" id="feed">
          <div className="w2-section-glow w2-section-glow--subtle" />
          <div className="w2-section-header w2-reveal">
            <h2 className="w2-display">
              Everything we publish goes on the public feed.
            </h2>
            <p className="w2-section-sub">
              Calls, charts, threads, generated by the engine and posted with timestamps. Wins and misses stay visible.
            </p>
          </div>

          <div className="w2-feed-grid w2-reveal">
            {w2Tweets.slice(0, 6).map((t) => (
              <a
                key={t.id}
                href={t.url || `https://x.com/${t.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w2-feed-card"
              >
                <div className="w2-feed-card-head">
                  <img
                    src={t.avatar}
                    alt=""
                    className="w2-feed-avatar"
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                  />
                  <div className="w2-feed-identity">
                    <span className="w2-feed-name">Spectre AI</span>
                    <span className="w2-feed-handle">@{t.handle}</span>
                  </div>
                  <svg className="w2-feed-x" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </div>
                <p className="w2-feed-text">{w2CleanTweetText(t.text)}</p>
                {t.mediaUrl && (
                  <div className="w2-feed-media">
                    <img src={t.mediaUrl} alt="" loading="lazy" />
                  </div>
                )}
                <div className="w2-feed-footer">
                  <span className="w2-feed-time">{w2FormatRelative(t.createdAt || t.time)}</span>
                  <div className="w2-feed-stats">
                    <span className="w2-feed-stat">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                      {w2FormatCount(t.views)}
                    </span>
                    <span className="w2-feed-stat">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                      {w2FormatCount(t.likes)}
                    </span>
                    <span className="w2-feed-stat">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                      {w2FormatCount(t.retweets)}
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>

          <div className="w2-feed-cta w2-reveal">
            <a
              className="w2-feed-follow"
              href="https://x.com/Spectre__AI"
              target="_blank"
              rel="noopener noreferrer"
            >
              Follow @Spectre__AI on X
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
            </a>
          </div>
        </section>
      )}

      {/* ═══════════════════════ TEAM ═══════════════════════ */}
      <section className="w2-team" id="team">
        <div className="w2-section-glow w2-section-glow--subtle" />
        <div className="w2-section-header w2-team-header w2-reveal">
          <h2 className="w2-display">The team is seven people, all of whom traded before they built this.</h2>
          <p className="w2-section-sub">
            Most of what Spectre does is something one of us wanted and couldn't find.
          </p>
        </div>

        {/* Team roster — editorial list, no avatars, no cards.
            Name + role on the left, available social links on the right. */}
        <ul className="w2-team-list w2-reveal">
          {TEAM.map((m, i) => {
            const idx = String(i + 1).padStart(2, '0')
            return (
              <li
                className={`w2-team-row w2-stagger-${Math.min(i + 1, 5)}`}
                key={m.name}
                style={{ '--team-accent': m.accent }}
              >
                <span className="w2-team-row-idx">{idx}</span>
                <div className="w2-team-row-main">
                  <h3 className="w2-team-row-name">{m.name}</h3>
                  <span className="w2-team-row-sep" aria-hidden="true" />
                  <p className="w2-team-row-role">{m.role}</p>
                  {m.tag && (
                    <span className="w2-team-row-tag">
                      <span className="w2-team-row-tag-dot" />
                      {m.tag}
                    </span>
                  )}
                </div>
                <div className="w2-team-row-links">
                  {m.linkedin && (
                    <a
                      className="w2-team-row-link"
                      href={m.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${m.name} on LinkedIn`}
                      data-kind="linkedin"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                    </a>
                  )}
                  {m.github && (
                    <a
                      className="w2-team-row-link"
                      href={m.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${m.name} on GitHub`}
                      data-kind="github"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
                    </a>
                  )}
                  {m.kaggle && (
                    <a
                      className="w2-team-row-link"
                      href={m.kaggle}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${m.name} on Kaggle`}
                      data-kind="kaggle"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.825 23.859c-.022.092-.117.141-.281.141h-3.139c-.187 0-.351-.082-.492-.248l-5.178-6.589-1.448 1.374v5.111c0 .235-.117.352-.351.352H5.505c-.236 0-.354-.117-.354-.352V.353c0-.233.118-.353.354-.353h2.431c.234 0 .351.12.351.353v14.343l6.203-6.272c.165-.165.33-.246.495-.246h3.239c.144 0 .236.06.285.18.046.149.034.255-.036.315l-6.555 6.344 6.836 8.507c.095.104.117.208.07.336" /></svg>
                    </a>
                  )}
                  {!m.linkedin && !m.github && !m.kaggle && (
                    <span className="w2-team-row-private">·</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {/* Data Sources + Web3 Partners block removed per feedback — the four
            flagship partners (Google / NVIDIA / TradingView / Bitquery) in the
            "Backed By" section above carry the credibility signal already. */}
      </section>

      {/* ═══════════════════════ FOOTER / WAITLIST ═══════════════════════ */}
      <footer className="w2-footer">
        <div className="w2-footer-stars" />
        <div className="w2-footer-aurora" />

        {/* Contained waitlist card - rounded panel with portraits flanking content */}
        <div className="w2-footer-card w2-reveal">
          <div className="w2-footer-card-glow" />
          <div className="w2-footer-card-grid" />

          <div className="w2-footer-card-inner">
            {/* Left portrait */}
            <div className="w2-footer-figure w2-footer-figure--left">
              <img
                src="/u4754797691_ultra_photorealistic_cinematic_lifestyle_photo_of_a_b5a7b4ee-1b49-4416-bc06-ae801a89a15d.jpg"
                alt=""
                className="w2-footer-figure-img"
              />
              <div className="w2-footer-figure-fade" />
            </div>

            {/* Center content */}
            <div className="w2-footer-content">
              <div className="w2-footer-kicker">
                <span className="w2-footer-kicker-dot" />
                EARLY ACCESS · WAITLIST OPEN
              </div>
              <h2 className="w2-footer-heading">
                Early access<br /><em>opens in waves.</em>
              </h2>
              <p className="w2-footer-sub">
                Leave an email. We&apos;ll notify you when your seat is ready.
              </p>
              <form className="w2-footer-form" onSubmit={(e) => { e.preventDefault(); const v = emailInput.trim(); if (v && v.includes('@')) { fireWaitlistWebhook(v, 'spectre-waitlist-footer'); setEmailInput(''); setThanksOpen(true) } }}>
                <label htmlFor="w2-waitlist-email" className="sr-only">Email address</label>
                <div className="w2-footer-form-inner">
                  <svg className="w2-footer-form-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  <input
                    id="w2-waitlist-email"
                    type="email"
                    className="w2-footer-input"
                    placeholder="you@company.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    required
                  />
                  <button type="submit" className="w2-footer-btn">
                    Request Access
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </button>
                </div>
              </form>
            </div>

            {/* Right portrait */}
            <div className="w2-footer-figure w2-footer-figure--right">
              <img
                src="/partnerka.eth_Create_a_vibrant_image_of_a_woman_working_on_her__3cef7db7-f12a-4972-8e6f-5d9612668bd7.jpg"
                alt=""
                className="w2-footer-figure-img"
              />
              <div className="w2-footer-figure-fade" />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="w2-footer-stats w2-reveal">
          <div className="w2-footer-stat">
            <span className="w2-footer-stat-value">50,000+</span>
            <span className="w2-footer-stat-label">Tokens tracked</span>
          </div>
          <div className="w2-footer-stat">
            <span className="w2-footer-stat-value">500+</span>
            <span className="w2-footer-stat-label">Data sources</span>
          </div>
          <div className="w2-footer-stat">
            <span className="w2-footer-stat-value">47,000</span>
            <span className="w2-footer-stat-label">Influencers mapped</span>
          </div>
          <div className="w2-footer-stat">
            <span className="w2-footer-stat-value">24/7</span>
            <span className="w2-footer-stat-label">AI monitoring</span>
          </div>
        </div>

        {/* Link grid */}
        <div className="w2-footer-links w2-reveal">
          <div className="w2-footer-brand">
            <img src="/spectre-logo-dark.png" alt="Spectre" className="w2-footer-brand-logo" onError={(e) => { e.target.style.display = 'none' }} />
            <p className="w2-footer-brand-tagline">
              AI market intelligence.<br />
              One screen. Every signal.
            </p>
          </div>
          <div className="w2-footer-col">
            <span className="w2-footer-col-label">Product</span>
            <a href="#demo">Live Demo</a>
            <a href="#atlas">Platform Atlas</a>
            <a href="#caps">Live Tools</a>
            <a href="#pricing">Pricing</a>
            <a href="/website2/api">API</a>
          </div>
          <div className="w2-footer-col">
            <span className="w2-footer-col-label">Company</span>
            <a href="#team">Team</a>
            <a href="#roadmap">Roadmap</a>
            <a href="#token">$SPECTRE Token</a>
            <a href="#social-intel">Intelligence</a>
          </div>
          <div className="w2-footer-col">
            <span className="w2-footer-col-label">Connect</span>
            <a href="https://x.com/Spectre__AI" target="_blank" rel="noopener noreferrer">X / Twitter</a>
            <a href="https://telegram.me/AI_SPECTRE" target="_blank" rel="noopener noreferrer">Telegram</a>
            <a href="https://www.youtube.com/@ai-spectre" target="_blank" rel="noopener noreferrer">YouTube</a>
            <a href="https://www.linkedin.com/company/ai-spectre" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            <a href="mailto:spectre@spectreai.io">spectre@spectreai.io</a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="w2-footer-bottom">
          <div className="w2-footer-bottom-left">
            <span>&copy; 2026 Spectre AI. All rights reserved.</span>
          </div>
          <div className="w2-footer-bottom-right">
            <a href="mailto:spectre@spectreai.io">spectre@spectreai.io</a>
          </div>
        </div>
      </footer>

      {/* ═══════════════════════ WAITLIST THANKS MODAL ═══════════════════════ */}
      {thanksOpen && (
        <div
          className="w2-thanks-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="w2-thanks-title"
          onClick={() => setThanksOpen(false)}
        >
          <div className="w2-thanks-modal-backdrop" aria-hidden="true" />
          <div className="w2-thanks-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="w2-thanks-modal-glow" aria-hidden="true" />
            <button
              type="button"
              className="w2-thanks-modal-close"
              onClick={() => setThanksOpen(false)}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>

            <div className="w2-thanks-modal-check">
              <span className="w2-thanks-modal-check-ring" aria-hidden="true" />
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>

            <div className="w2-thanks-modal-eyebrow">
              <span className="w2-thanks-modal-dot" />
              You&apos;re on the list
            </div>

            <h3 id="w2-thanks-title" className="w2-thanks-modal-title">
              Welcome to Spectre.
            </h3>
            <p className="w2-thanks-modal-sub">
              We&apos;ll email you the moment a seat at the terminal opens. $SPECTRE holders get access first.
            </p>

            <div className="w2-thanks-modal-actions">
              <button
                type="button"
                className="w2-thanks-modal-btn w2-thanks-modal-btn--primary"
                onClick={() => setThanksOpen(false)}
              >
                Got it
              </button>
              <a
                className="w2-thanks-modal-btn w2-thanks-modal-btn--ghost"
                href="https://x.com/Spectre__AI"
                target="_blank"
                rel="noopener noreferrer"
              >
                Follow on X
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
              </a>
            </div>

            <div className="w2-thanks-modal-footer">
              <span className="w2-thanks-modal-footer-dot" />
              <span>Seat held. No spam, ever.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
