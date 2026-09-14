/**
 * DealFlowPipeline - "The Deal Room"
 * AngelList/Carta meets on-chain discovery.
 * Tokens presented as deals flowing through institutional stages:
 *   Sourced → Due Diligence → High Conviction → Positioned
 *
 * Each card shows a mini thesis, risk score, smart money activity,
 * and key catalysts. Think: a VC partner's Monday morning deal review.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getTokenLogo } from '../data/alphaFeedData'
import { formatMcap, formatVolume, formatPrice } from '../hooks/useResearchDeskPrices'
import InfoTip from './InfoTip'
import './DealFlowPipeline.css'

/* ── Social icon SVG paths ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'], fill: true },
  x: { viewBox: '0 0 24 24', paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'], fill: true },
  discord: { viewBox: '0 0 24 24', paths: ['M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'], fill: true },
  telegram: { viewBox: '0 0 24 24', paths: ['M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'], fill: true },
  github: { viewBox: '0 0 24 24', paths: ['M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'], fill: true },
}

const STAGE_TIPS = {
  'sourced': 'Initial discovery - tokens flagged as potentially interesting by our screening algorithms.',
  'diligence': 'Under active research - verifying claims, analyzing on-chain data, and stress-testing the thesis.',
  'conviction': 'Passed due diligence with a strong fundamental thesis and favorable risk-reward profile.',
  'positioned': 'Capital deployed - actively monitoring the position, tracking catalysts and exit conditions.',
}

/* ── Stage definitions ── */
const STAGES = [
  {
    id: 'sourced',
    label: 'Sourced',
    subtitle: 'New discoveries',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  },
  {
    id: 'diligence',
    label: 'Due Diligence',
    subtitle: 'Under review',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    id: 'conviction',
    label: 'High Conviction',
    subtitle: 'Strong thesis',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    id: 'positioned',
    label: 'Positioned',
    subtitle: 'Active positions',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
]

/* ── Mock deal data - institutional-grade fields ── */
const DEALS = [
  // Sourced
  {
    id: 'd1', stage: 'sourced', symbol: 'MORPHO', name: 'Morpho',
    thesis: 'Next-gen lending optimizer capturing Aave/Compound flow',
    risk: 'B+', riskColor: '#10B981',
    smartMoney: '+$4.2M (3d)', smartMoneyDir: 'bullish',
    catalyst: 'Mainnet v2 launch Q1',
    sector: 'DeFi', change24h: 18.4, mcap: '$320M',
    holders: '12.4K', holderChange: '+8.2%',
    fdv: '$1.1B', volume24h: '$42M', tvl: '$1.8B', chain: 'Ethereum',
    circulatingPct: 29, backers: ['a16z', 'Variant', 'Nascent'],
    strengths: ['Capital-efficient peer-to-peer matching', 'Higher yields than pool-based lending', 'Battle-tested codebase with 3 audits'],
    risks: ['Aave v4 could erode competitive edge', 'Low float - large unlock cliff in Q3', 'Governance token utility still unclear'],
    socials: { website: 'https://morpho.org', x: 'https://x.com/MorphoLabs', discord: 'https://discord.gg/morpho', github: 'https://github.com/morpho-org' },
  },
  {
    id: 'd3', stage: 'sourced', symbol: 'ETHFI', name: 'Ether.fi',
    thesis: 'Liquid restaking leader with institutional-grade UX',
    risk: 'B+', riskColor: '#10B981',
    smartMoney: '+$2.8M (3d)', smartMoneyDir: 'bullish',
    catalyst: 'Cash product launch',
    sector: 'DeFi', change24h: 12.1, mcap: '$480M',
    holders: '34.1K', holderChange: '+5.4%',
    fdv: '$3.2B', volume24h: '$28M', tvl: '$5.1B', chain: 'Ethereum',
    circulatingPct: 15, backers: ['Bullish', 'OKX Ventures', 'Consensys'],
    strengths: ['#1 liquid restaking by TVL', 'eETH integration across major DeFi', 'Visa card bridges DeFi yield to tradfi'],
    risks: ['Heavily dependent on EigenLayer incentives', 'Low circulating supply creates overhang', 'Competitive moat is thin vs Renzo/Kelp'],
    socials: { website: 'https://ether.fi', x: 'https://x.com/ether_fi', discord: 'https://discord.gg/etherfi', telegram: 'https://telegram.me/etherfi' },
  },
  // Due Diligence
  {
    id: 'd4', stage: 'diligence', symbol: 'ONDO', name: 'Ondo Finance',
    thesis: 'Institutional-grade RWA tokenization - "the BlackRock of DeFi"',
    risk: 'A-', riskColor: '#10B981',
    smartMoney: '+$18M (7d)', smartMoneyDir: 'bullish',
    catalyst: 'Treasury product SEC filing',
    sector: 'RWA', change24h: 8.3, mcap: '$2.1B',
    holders: '145K', holderChange: '+12.3%',
    fdv: '$6.8B', volume24h: '$156M', tvl: '$620M', chain: 'Ethereum + Solana',
    circulatingPct: 31, backers: ['Pantera', 'Founders Fund', 'Coinbase Ventures'],
    strengths: ['Real yield from US Treasuries (OUSG)', 'Institutional-grade compliance framework', 'Expanding to Solana + cross-chain'],
    risks: ['Regulatory uncertainty around tokenized securities', 'BlackRock BUIDL fund is a direct competitor', 'Revenue margins compress as rates fall'],
    socials: { website: 'https://ondo.finance', x: 'https://x.com/OndoFinance', discord: 'https://discord.gg/ondo', telegram: 'https://telegram.me/ondofinance' },
  },
  {
    id: 'd5', stage: 'diligence', symbol: 'TAO', name: 'Bittensor',
    thesis: 'Decentralized AI compute marketplace - "AWS for AI models"',
    risk: 'B', riskColor: '#FBBF24',
    smartMoney: '+$6.4M (7d)', smartMoneyDir: 'bullish',
    catalyst: 'Subnet 32 launch (text-to-video)',
    sector: 'AI Agents', change24h: -3.2, mcap: '$3.8B',
    holders: '67.8K', holderChange: '+2.1%',
    fdv: '$3.8B', volume24h: '$62M', chain: 'Bittensor (Substrate)',
    circulatingPct: 100, backers: ['DCG', 'Polychain', 'GSR'],
    strengths: ['Unique subnet architecture creates an AI model marketplace', 'Fully diluted - no future token unlocks', 'Growing subnet ecosystem (32+ active)'],
    risks: ['Valuation quality of AI outputs is subjective', 'Emission schedule rewards miners over stakers', 'Complex tokenomics not well understood'],
    socials: { website: 'https://bittensor.com', x: 'https://x.com/opabortel', discord: 'https://discord.gg/bittensor', github: 'https://github.com/opentensor' },
  },
  // High Conviction
  {
    id: 'd10', stage: 'conviction', symbol: 'SPECTRE', name: 'Spectre AI',
    thesis: 'AI-powered non-custodial trading terminal. On-chain intelligence layer bridging institutional analytics to DeFi - "the Bloomberg Terminal of crypto."',
    risk: 'A-', riskColor: '#10B981',
    smartMoney: '+$3.8M (7d)', smartMoneyDir: 'bullish',
    catalyst: 'V2 terminal launch + AI agent trading integration',
    sector: 'AI Agents', change24h: 22.6, mcap: '$48M',
    holders: '8.2K', holderChange: '+18.4%',
    address: '0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6',
    fdv: '$48M', volume24h: '$5.2M', chain: 'Ethereum',
    circulatingPct: 100, backers: ['Community-funded', 'Angel investors'],
    strengths: ['Non-custodial architecture - user owns keys', 'AI-driven alpha generation + deal flow', 'Early mover in on-chain intelligence terminals'],
    risks: ['Small market cap - high volatility', 'Competing with established terminals (Dexscreener, Birdeye)', 'Revenue model still maturing'],
    socials: { website: 'https://spectre-ai.io', x: 'https://x.com/Spectre__AI', telegram: 'https://telegram.me/AI_SPECTRE' },
  },
  {
    id: 'd6', stage: 'conviction', symbol: 'SOL', name: 'Solana',
    thesis: 'Layer 1 winner for consumer crypto + payments. Network effects compounding.',
    risk: 'A', riskColor: '#10B981',
    smartMoney: '+$142M (30d)', smartMoneyDir: 'bullish',
    catalyst: 'Firedancer client + ETF filing',
    sector: 'Infrastructure', change24h: 4.1, mcap: '$78B',
    holders: '1.2M', holderChange: '+1.8%',
    fdv: '$96B', volume24h: '$3.2B', tvl: '$8.4B', chain: 'Solana',
    circulatingPct: 81, backers: ['a16z', 'Multicoin', 'Jump', 'Alameda (historical)'],
    strengths: ['400ms block times - best UX in crypto', 'Firedancer second client eliminates single-point risk', 'Dominant in consumer + payments (Helium, Render, Visa)'],
    risks: ['Network outage history hurts institutional confidence', 'MEV extraction creating poor user experience', 'ETF approval timeline uncertain'],
    socials: { website: 'https://solana.com', x: 'https://x.com/solana', discord: 'https://discord.gg/solana', github: 'https://github.com/solana-labs' },
  },
  {
    id: 'd7', stage: 'conviction', symbol: 'AAVE', name: 'Aave',
    thesis: 'DeFi blue chip. $12B TVL, fee switch imminent. "The JPMorgan of DeFi."',
    risk: 'A', riskColor: '#10B981',
    smartMoney: '+$28M (30d)', smartMoneyDir: 'bullish',
    catalyst: 'GHO stablecoin scaling + fee switch vote',
    sector: 'DeFi', change24h: 2.8, mcap: '$4.2B',
    holders: '198K', holderChange: '+4.6%',
    fdv: '$4.2B', volume24h: '$210M', tvl: '$12.1B', chain: 'Multi-chain',
    circulatingPct: 100, backers: ['Framework', 'Blockchain Capital', 'Standard Crypto'],
    strengths: ['$12B TVL across 12 chains - unmatched scale', 'GHO stablecoin creates new revenue stream', 'Fee switch proposal would return value to holders'],
    risks: ['Morpho/Euler v2 innovating faster on matching', 'GHO adoption slower than projected', 'Regulatory risk for lending protocols'],
    socials: { website: 'https://aave.com', x: 'https://x.com/aabortel', discord: 'https://discord.gg/aave', github: 'https://github.com/aave' },
  },
  // Positioned
  {
    id: 'd8', stage: 'positioned', symbol: 'ETH', name: 'Ethereum',
    thesis: 'Base layer of the internet of value. Deflationary, institutional adoption accelerating.',
    risk: 'A+', riskColor: '#10B981',
    smartMoney: '+$1.2B (30d)', smartMoneyDir: 'bullish',
    catalyst: 'Pectra upgrade + ETF inflows',
    sector: 'Infrastructure', change24h: 1.4, mcap: '$380B',
    holders: '120M', holderChange: '+0.4%',
    entry: '$2,840', current: '$3,240', pnl: '+14.1%',
    fdv: '$380B', volume24h: '$18B', tvl: '$62B', chain: 'Ethereum',
    circulatingPct: 100, backers: ['Ethereum Foundation', 'ConsenSys', 'Paradigm'],
    strengths: ['Deflationary supply since The Merge', '$62B TVL - dominant settlement layer', 'ETF approved - institutional on-ramp secured'],
    risks: ['L2 fragmentation dilutes base-layer value', 'Solana competing aggressively on UX/speed', 'Gas costs still volatile for small users'],
    socials: { website: 'https://ethereum.org', x: 'https://x.com/ethereum', discord: 'https://discord.gg/ethereum', github: 'https://github.com/ethereum' },
  },
  {
    id: 'd9', stage: 'positioned', symbol: 'LINK', name: 'Chainlink',
    thesis: 'Oracle monopoly. CCIP cross-chain protocol positions it as "the Stripe of crypto."',
    risk: 'A', riskColor: '#10B981',
    smartMoney: '+$34M (30d)', smartMoneyDir: 'bullish',
    catalyst: 'Staking v0.2 + CCIP expansion',
    sector: 'Infrastructure', change24h: 3.6, mcap: '$12.8B',
    holders: '720K', holderChange: '+2.9%',
    entry: '$14.20', current: '$18.40', pnl: '+29.6%',
    fdv: '$12.8B', volume24h: '$480M', chain: 'Multi-chain',
    circulatingPct: 100, backers: ['Framework', 'Ari Paul', 'Naval Ravikant'],
    strengths: ['Secures 75%+ of all DeFi TVL via oracles', 'CCIP positions as cross-chain infrastructure layer', 'SWIFT partnership validates enterprise adoption'],
    risks: ['CCIP competes with LayerZero, Wormhole', 'Token utility is staking-only - no governance', 'Team wallet holds significant supply'],
    socials: { website: 'https://chain.link', x: 'https://x.com/chainlink', discord: 'https://discord.gg/chainlink', github: 'https://github.com/smartcontractkit' },
  },
]

/* ── Codex/DexScreener dual-format change → percent ──
   The bundle's change fields are dual-format: |v| < 1 is a RATIO (×100),
   |v| >= 1 is already a PERCENT. The card renders the number directly with a
   '%' suffix, so we normalize to percent here. null/undefined → null (omit). */
function pctFromRatio(v) {
  if (v == null || isNaN(v)) return null
  return Math.abs(v) < 1 ? v * 100 : v
}

/* ── Map a dynamic backend project → the DEAL shape the card/modal renders ──
   Objective data only. NULL prose fields (catalyst/strengths/risks) are left
   undefined so the UI guards (which already check `deal.x?.length` / truthy)
   omit those rows/sections gracefully. */
function mapProjectToDeal(p) {
  const m = p.scorecard?.metrics || {}
  // Smart-money proxy: short factual TVL-flow string from the 7d TVL change.
  // No wallet-flow feed exists, so we surface the directional TVL signal.
  // DefiLlama change_7d is ALREADY a percent (-0.7 = -0.7%) - do NOT run it through
  // pctFromRatio (that ratio->% rule turns -0.7% into -68.5%). Use it directly.
  const tvl7d = (p.tvlChange7d != null && !isNaN(p.tvlChange7d)) ? Number(p.tvlChange7d) : null
  let smartMoney = null
  let smartMoneyDir = 'bullish'
  if (tvl7d != null) {
    const sign = tvl7d >= 0 ? '+' : ''
    smartMoney = `TVL ${sign}${tvl7d.toFixed(1)}% (7d)`
    smartMoneyDir = tvl7d >= 0 ? 'bullish' : 'bearish'
  }
  return {
    id: p.id || p.slug || p.symbol,
    stage: p.dealFlowStage || 'sourced',
    symbol: p.symbol,
    name: p.name,
    logo: p.logo || null,
    address: p.address || null,
    thesis: p.thesis || `${p.category || p.sector || 'DeFi'} protocol`,
    risk: p.riskGrade || 'C',
    riskColor: p.riskColor || '#FBBF24',
    change24h: pctFromRatio(p.change24h),
    // Pre-formatted strings from the bundle scorecard.metrics (e.g. "$21.1M").
    mcap: m.mcap || formatMcap(p.mcap) || null,
    fdv: m.fdv || formatMcap(p.fdv) || null,
    volume24h: m.volume24h || formatVolume(p.volume24h) || null,
    tvl: m.tvl || formatMcap(p.tvl) || null,
    sector: p.sector || p.category || 'DeFi',
    chain: p.chain || null,
    // Smart-money proxy (TVL flow). null → row omitted by the render guard.
    ...(smartMoney ? { smartMoney, smartMoneyDir } : {}),
    socials: p.socials && Object.keys(p.socials).length ? p.socials : null,
    // catalyst / strengths / risks / holders / backers / circulatingPct are
    // intentionally left undefined (Phase 2 prose / no holder feed) — the UI
    // guards each before rendering, so they're omitted, never "undefined".
  }
}

function DealFlowPipeline({ activeSymbol, livePrices = {}, projects = null }) {
  const [activeStage, setActiveStage] = useState(null) // null = show all
  const [visibleCards, setVisibleCards] = useState(new Set())
  const [expandedDeal, setExpandedDeal] = useState(null)
  const cardRefs = useRef({})

  /* Dynamic backend projects (preferred) → DEAL shape; fall back to static
     DEALS for back-compat (and the CoinGecko live overlay) when absent. */
  const deals = useMemo(() => {
    if (Array.isArray(projects) && projects.length > 0) {
      return projects.map(mapProjectToDeal)
    }
    if (!livePrices || Object.keys(livePrices).length === 0) return DEALS
    return DEALS.map(deal => {
      const live = livePrices[deal.symbol]
      if (!live) return deal
      return {
        ...deal,
        mcap: formatMcap(live.mcap) || deal.mcap,
        change24h: live.change24h != null ? live.change24h : deal.change24h,
        volume24h: formatVolume(live.volume24h) || deal.volume24h,
        fdv: formatMcap(live.fdv) || deal.fdv,
        // For positioned deals, update current price
        ...(deal.current ? { current: formatPrice(live.price) || deal.current } : {}),
      }
    })
  }, [projects, livePrices])

  /* Intersection observer for card entrance animation */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setVisibleCards(prev => new Set([...prev, entry.target.dataset.id]))
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )
    Object.values(cardRefs.current).forEach(el => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [activeStage])

  /* Escape key to close modal + body scroll lock */
  useEffect(() => {
    if (!expandedDeal) return
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setExpandedDeal(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [expandedDeal])

  const filteredDeals = activeStage
    ? deals.filter(d => d.stage === activeStage)
    : deals

  const stageCount = (stageId) => deals.filter(d => d.stage === stageId).length

  return (
    <div className="dfp">
      {/* Stage tabs - Kanban-style pipeline stages */}
      <div className="dfp-stages">
        <button
          className={`dfp-stage-tab ${activeStage === null ? 'is-active' : ''}`}
          onClick={() => setActiveStage(null)}
        >
          <span className="dfp-stage-tab-label">All</span>
          <span className="dfp-stage-tab-count">{deals.length}</span>
        </button>
        {STAGES.map(stage => (
          <button
            key={stage.id}
            className={`dfp-stage-tab ${activeStage === stage.id ? 'is-active' : ''}`}
            onClick={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
          >
            <svg className="dfp-stage-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={stage.icon} />
            </svg>
            <span className="dfp-stage-tab-label">{stage.label}<InfoTip text={STAGE_TIPS[stage.id]} position="bottom" /></span>
            <span className="dfp-stage-tab-count">{stageCount(stage.id)}</span>
          </button>
        ))}
      </div>

      {/* Deal cards grid */}
      <div className="dfp-grid">
        {filteredDeals.map((deal, i) => {
          const stage = STAGES.find(s => s.id === deal.stage) || STAGES[0]
          const logo = deal.logo || getTokenLogo(deal.symbol)
          const isVisible = visibleCards.has(deal.id)

          return (
            <div
              key={deal.id}
              className={`dfp-card dfp-card--${deal.stage} ${isVisible ? 'is-visible' : ''} ${activeSymbol && deal.symbol === activeSymbol ? 'is-highlighted' : ''} ${activeSymbol && deal.symbol !== activeSymbol ? 'is-dimmed' : ''}`}
              data-id={deal.id}
              ref={el => cardRefs.current[deal.id] = el}
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => setExpandedDeal(deal)}
            >
              {/* Top accent edge */}
              <div className="dfp-card-accent" aria-hidden="true" />

              {/* Stage badge */}
              <div className="dfp-card-stage">
                <span className="dfp-card-stage-dot" />
                <span className="dfp-card-stage-label">{stage.label}</span>
              </div>

              {/* Token header */}
              <div className="dfp-card-head">
                <div className="dfp-card-token">
                  {logo ? (
                    // 120 project cards render one logo each and nearly all of
                    // them start below the fold - eager loading opened 120
                    // third-party CDN requests the moment the board painted.
                    <img
                      className="dfp-card-logo"
                      src={logo}
                      alt={deal.symbol}
                      loading="lazy"
                      decoding="async"
                      width={36}
                      height={36}
                    />
                  ) : (
                    <div className="dfp-card-logo dfp-card-logo--fallback">
                      {deal.symbol.charAt(0)}
                    </div>
                  )}
                  <div className="dfp-card-names">
                    <span className="dfp-card-symbol">{deal.symbol}</span>
                    <span className="dfp-card-name">{deal.name}</span>
                  </div>
                </div>
                <div className="dfp-card-risk" style={{ color: deal.riskColor }}>
                  {deal.risk}
                </div>
              </div>

              {/* Thesis */}
              <p className="dfp-card-thesis">{deal.thesis}</p>

              {/* Metrics row - third cell prefers Holders, falls back to TVL/Vol */}
              <div className="dfp-card-metrics">
                <div className="dfp-card-metric">
                  <span className="dfp-card-metric-label">Mcap</span>
                  <span className="dfp-card-metric-value">{deal.mcap || '-'}</span>
                </div>
                <div className="dfp-card-metric">
                  <span className="dfp-card-metric-label">24h</span>
                  {deal.change24h != null ? (
                    <span className={`dfp-card-metric-value ${deal.change24h >= 0 ? 'is-bull' : 'is-bear'}`}>
                      {deal.change24h >= 0 ? '+' : ''}{Number(deal.change24h).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="dfp-card-metric-value">-</span>
                  )}
                </div>
                <div className="dfp-card-metric">
                  {deal.holders != null ? (
                    <>
                      <span className="dfp-card-metric-label">Holders</span>
                      <span className="dfp-card-metric-value">{deal.holders}</span>
                    </>
                  ) : deal.tvl ? (
                    <>
                      <span className="dfp-card-metric-label">TVL</span>
                      <span className="dfp-card-metric-value">{deal.tvl}</span>
                    </>
                  ) : (
                    <>
                      <span className="dfp-card-metric-label">Vol 24h</span>
                      <span className="dfp-card-metric-value">{deal.volume24h || '-'}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Smart money signal - omitted when no flow signal available */}
              {deal.smartMoney && (
                <div className={`dfp-card-signal dfp-card-signal--${deal.smartMoneyDir}`}>
                  <span className="dfp-card-signal-pulse" />
                  <span className="dfp-card-signal-label">Smart Money<InfoTip text="Large wallet and institutional capital flow direction and magnitude." position="top" /></span>
                  <span className="dfp-card-signal-text">{deal.smartMoney}</span>
                </div>
              )}

              {/* Catalyst - omitted when none provided (Phase 2 prose) */}
              {deal.catalyst && (
                <div className="dfp-card-catalyst">
                  <span className="dfp-card-catalyst-label">Catalyst<InfoTip text="Upcoming event that could significantly move the price - launches, partnerships, unlocks." position="top" /></span>
                  <span className="dfp-card-catalyst-text">{deal.catalyst}</span>
                </div>
              )}

              {/* P&L for positioned deals */}
              {deal.pnl && (
                <div className="dfp-card-pnl">
                  <div className="dfp-card-pnl-row">
                    <span className="dfp-card-pnl-label">Entry</span>
                    <span className="dfp-card-pnl-value">{deal.entry}</span>
                  </div>
                  <div className="dfp-card-pnl-row">
                    <span className="dfp-card-pnl-label">Current</span>
                    <span className="dfp-card-pnl-value">{deal.current}</span>
                  </div>
                  <div className="dfp-card-pnl-row dfp-card-pnl-row--total">
                    <span className="dfp-card-pnl-label">P&L</span>
                    <span className="dfp-card-pnl-value is-bull">{deal.pnl}</span>
                  </div>
                </div>
              )}

              {/* Sector pill */}
              <div className="dfp-card-sector">{deal.sector}</div>
            </div>
          )
        })}
      </div>

      {/* ── Expanded deal modal - portaled to body to escape scroll-reveal containing block ── */}
      {expandedDeal && createPortal(
        (() => {
          const deal = expandedDeal
          const stage = STAGES.find(s => s.id === deal.stage) || STAGES[0]
          const logo = deal.logo || getTokenLogo(deal.symbol)

          return (
            <div className="dfp-overlay" onClick={() => setExpandedDeal(null)}>
              <div
                className={`dfp-modal dfp-modal--${deal.stage}`}
                onClick={e => e.stopPropagation()}
              >
                {/* Ambient stage glow - radial wash for cinematic depth */}
                <div className="dfp-modal-glow" aria-hidden="true" />
                {/* Top accent edge */}
                <div className="dfp-modal-accent" aria-hidden="true" />

                {/* Header row: stage + close - stagger idx 0 */}
                <div className="dfp-modal-top dfp-modal-stagger" style={{ '--stagger': 0 }}>
                  <div className="dfp-modal-stage">
                    <span className="dfp-modal-stage-dot" />
                    <span className="dfp-modal-stage-label">{stage.label}</span>
                    <span className="dfp-modal-stage-sep" aria-hidden="true" />
                    <span className="dfp-modal-stage-sub">{stage.subtitle}</span>
                  </div>
                  <button
                    className="dfp-modal-close"
                    onClick={() => setExpandedDeal(null)}
                    aria-label="Close"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Token identity - stagger idx 1 */}
                <div className="dfp-modal-identity dfp-modal-stagger" style={{ '--stagger': 1 }}>
                  <div className="dfp-modal-token">
                    <div className="dfp-modal-logo-wrap">
                      {logo ? (
                        <img className="dfp-modal-logo" src={logo} alt={deal.symbol} />
                      ) : (
                        <div className="dfp-modal-logo dfp-modal-logo--fallback">
                          {deal.symbol.charAt(0)}
                        </div>
                      )}
                      <div className="dfp-modal-logo-ring" aria-hidden="true" />
                    </div>
                    <div className="dfp-modal-names">
                      <span className="dfp-modal-symbol">{deal.symbol}</span>
                      <span className="dfp-modal-name">{deal.name}</span>
                    </div>
                  </div>
                  <div className="dfp-modal-risk-wrap">
                    <span className="dfp-modal-risk-label">Risk Grade<InfoTip text="Overall risk assessment from A (lowest) to D (highest), based on liquidity, concentration, and volatility." position="left" /></span>
                    <span className="dfp-modal-risk" style={{ color: deal.riskColor, '--risk-color': deal.riskColor }}>
                      {deal.risk}
                    </span>
                  </div>
                </div>

                {/* Gradient divider */}
                <div className="dfp-modal-divider" aria-hidden="true" />

                {/* Thesis - stagger idx 2 */}
                <div className="dfp-modal-section dfp-modal-stagger" style={{ '--stagger': 2 }}>
                  <span className="dfp-modal-section-label">Investment Thesis</span>
                  <p className="dfp-modal-thesis">{deal.thesis}</p>
                </div>

                {/* Unified metrics grid - all 8 stats in one wide row - stagger idx 3 */}
                <div className="dfp-modal-metrics dfp-modal-metrics--wide dfp-modal-stagger" style={{ '--stagger': 3 }}>
                  {deal.mcap && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">Market Cap</span>
                      <span className="dfp-modal-metric-value">{deal.mcap}</span>
                    </div>
                  )}
                  {deal.fdv && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">FDV</span>
                      <span className="dfp-modal-metric-value">{deal.fdv}</span>
                    </div>
                  )}
                  {deal.volume24h && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">Vol 24h</span>
                      <span className="dfp-modal-metric-value">{deal.volume24h}</span>
                    </div>
                  )}
                  {deal.tvl && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">TVL</span>
                      <span className="dfp-modal-metric-value">{deal.tvl}</span>
                    </div>
                  )}
                  {deal.change24h != null && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">24h</span>
                      <span className={`dfp-modal-metric-value ${deal.change24h >= 0 ? 'is-bull' : 'is-bear'}`}>
                        {deal.change24h >= 0 ? '+' : ''}{Number(deal.change24h).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {deal.holders != null && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">Holders</span>
                      <span className="dfp-modal-metric-value">{deal.holders}</span>
                    </div>
                  )}
                  {deal.holderChange != null && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">Holder Chg</span>
                      <span className="dfp-modal-metric-value is-bull">{deal.holderChange}</span>
                    </div>
                  )}
                  {deal.circulatingPct != null && (
                    <div className="dfp-modal-metric">
                      <span className="dfp-modal-metric-label">Circ.</span>
                      <span className="dfp-modal-metric-value">{deal.circulatingPct}%</span>
                    </div>
                  )}
                </div>

                {/* Two-column row: Smart Money + Catalyst - stagger idx 4.
                    Entire row omitted when neither signal is available. */}
                {(deal.smartMoney || deal.catalyst) && (
                  <div className="dfp-modal-row dfp-modal-stagger" style={{ '--stagger': 4 }}>
                    {/* Smart money signal */}
                    {deal.smartMoney && (
                      <div className={`dfp-modal-signal dfp-modal-signal--${deal.smartMoneyDir}`}>
                        <div className="dfp-modal-signal-head">
                          <span className="dfp-modal-signal-pulse" />
                          <span className="dfp-modal-signal-title">Smart Money Flow</span>
                        </div>
                        <div className="dfp-modal-signal-body">
                          <span className="dfp-modal-signal-amount">{deal.smartMoney}</span>
                          <span className={`dfp-modal-signal-dir dfp-modal-signal-dir--${deal.smartMoneyDir}`}>
                            {deal.smartMoneyDir === 'bullish' ? '↑' : '↓'} {deal.smartMoneyDir}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Catalyst */}
                    {deal.catalyst && (
                      <div className="dfp-modal-section dfp-modal-section--compact">
                        <span className="dfp-modal-section-label">Upcoming Catalyst</span>
                        <div className="dfp-modal-catalyst">
                          <div className="dfp-modal-catalyst-icon-wrap">
                            <svg className="dfp-modal-catalyst-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          </div>
                          <span className="dfp-modal-catalyst-text">{deal.catalyst}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* P&L - positioned deals - stagger idx 5 */}
                {deal.pnl && (
                  <div className="dfp-modal-pnl dfp-modal-stagger" style={{ '--stagger': 5 }}>
                    <span className="dfp-modal-section-label">Position Performance</span>
                    <div className="dfp-modal-pnl-grid">
                      <div className="dfp-modal-pnl-cell">
                        <span className="dfp-modal-pnl-label">Entry</span>
                        <span className="dfp-modal-pnl-value">{deal.entry}</span>
                      </div>
                      <div className="dfp-modal-pnl-cell">
                        <span className="dfp-modal-pnl-label">Current</span>
                        <span className="dfp-modal-pnl-value">{deal.current}</span>
                      </div>
                      <div className="dfp-modal-pnl-cell dfp-modal-pnl-cell--highlight">
                        <span className="dfp-modal-pnl-label">Unrealized P&L</span>
                        <span className="dfp-modal-pnl-value is-bull">{deal.pnl}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Two-column row: Strengths + Risks - stagger idx 6 */}
                {(deal.strengths?.length > 0 || deal.risks?.length > 0) && (
                  <div className="dfp-modal-row dfp-modal-row--equal dfp-modal-stagger" style={{ '--stagger': 6 }}>
                    {deal.strengths?.length > 0 && (
                      <div className="dfp-modal-section dfp-modal-section--compact">
                        <span className="dfp-modal-section-label">Key Strengths</span>
                        <ul className="dfp-modal-list dfp-modal-list--strengths">
                          {deal.strengths.map((s, idx) => (
                            <li key={idx} className="dfp-modal-list-item">
                              <span className="dfp-modal-list-dot dfp-modal-list-dot--green" />
                              <span className="dfp-modal-list-text">{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {deal.risks?.length > 0 && (
                      <div className="dfp-modal-section dfp-modal-section--compact">
                        <span className="dfp-modal-section-label">Key Risks</span>
                        <ul className="dfp-modal-list dfp-modal-list--risks">
                          {deal.risks.map((r, idx) => (
                            <li key={idx} className="dfp-modal-list-item">
                              <span className="dfp-modal-list-dot dfp-modal-list-dot--amber" />
                              <span className="dfp-modal-list-text">{r}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer: chain + backers + socials + sector + address - stagger idx 7 */}
                <div className="dfp-modal-divider" aria-hidden="true" />
                <div className="dfp-modal-footer dfp-modal-stagger" style={{ '--stagger': 7 }}>
                  <div className="dfp-modal-footer-left">
                    <span className="dfp-modal-sector">{deal.sector}</span>
                    {deal.chain && (
                      <span className="dfp-modal-chain-badge">
                        <svg className="dfp-modal-chain-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                        {deal.chain}
                      </span>
                    )}
                    {deal.backers?.length > 0 && (
                      <div className="dfp-modal-backers">
                        {deal.backers.map((b, idx) => (
                          <span key={idx} className="dfp-modal-backer-pill">{b}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="dfp-modal-footer-right">
                    {deal.socials && Object.keys(deal.socials).length > 0 && (
                      <div className="dfp-modal-socials">
                        {Object.entries(deal.socials).map(([key, url]) => {
                          const icon = SOCIAL_ICONS[key]
                          if (!icon) return null
                          return (
                            <a
                              key={key}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="dfp-modal-social-link"
                              title={key.charAt(0).toUpperCase() + key.slice(1)}
                              onClick={e => e.stopPropagation()}
                            >
                              <svg width="14" height="14" viewBox={icon.viewBox}>
                                {icon.paths.map((d, i) => (
                                  <path key={i} d={d} fill={icon.fill ? 'currentColor' : 'none'} stroke={icon.fill ? 'none' : 'currentColor'} strokeWidth={icon.fill ? undefined : '2'} />
                                ))}
                              </svg>
                            </a>
                          )
                        })}
                      </div>
                    )}
                    {deal.address && (
                      <span className="dfp-modal-address" title={deal.address}>
                        {deal.address.slice(0, 6)}...{deal.address.slice(-4)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })(),
        document.body
      )}
    </div>
  )
}

export default DealFlowPipeline
