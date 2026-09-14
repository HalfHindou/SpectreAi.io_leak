/**
 * TokenPitchDeck - "The Investor Deck"
 * Every token presented like a startup raising a round.
 * Two view modes:
 *   Cards  - all 7 slides stacked vertically (compact)
 *   Slides - one slide at a time, presentation-style with
 *            SVG graphics, nav arrows, keyboard support
 *
 * This is the deep due-diligence layer - what a VC partner
 * reviews before writing a check.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { getTokenLogo } from '../data/alphaFeedData'
import { formatMcap } from '../hooks/useResearchDeskPrices'
import InfoTip from './InfoTip'
import './TokenPitchDeck.css'

/* ── Slide definitions ── */
const SLIDE_LABELS = [
  'Cover',
  'Problem & Solution',
  'Traction',
  'Tokenomics',
  'Team & Backers',
  'Competitive Moat',
  'Valuation',
]

/* ── Pitch deck data ──
 * FALLBACK_PITCHES is the static seed shown only when no dynamic `projects`
 * arrive (e.g. cold load / bundle empty). When projects are present the deck is
 * built from real on-chain data via mapProjectToPitch and, where the AI content
 * tier has populated, enriched with the AI prose deck. Never delete this array. */
const FALLBACK_PITCHES = [
  {
    id: 'p0',
    symbol: 'SPECTRE',
    name: 'Spectre AI',
    tagline: 'The Bloomberg Terminal of Crypto',
    comparable: 'What Bloomberg Terminal did for Wall Street, Spectre does for on-chain trading intelligence',
    sector: 'AI Agents',
    stage: 'Early Growth',
    address: '0x9Cf0ED013e67DB12cA3AF8e7506fE401aA14dAd6',
    problem: 'Crypto traders are flying blind. Retail relies on fragmented tools - DexScreener for charts, Twitter for alpha, Etherscan for on-chain data. No single platform combines institutional-grade analytics, AI-driven signals, and real-time execution. The information asymmetry between smart money and retail is widening.',
    solution: 'A non-custodial AI-powered trading terminal that aggregates real-time market data, whale tracking, sector rotation, and on-chain intelligence into one interface. AI agents analyze deal flow, score tokens institutionally, and surface alpha - turning every retail trader into a Bloomberg desk.',
    traction: {
      aum: { value: '$48M', label: 'Market Cap', change: '+340%', period: '30d' },
      users: { value: '8.2K', label: 'Token Holders', change: '+184%', period: '30d' },
      revenue: { value: '42K', label: 'Terminal Sessions (MAU)', change: '+520%', period: 'MoM' },
      gmv: { value: '$12.4M', label: 'Daily Token Volume', change: '+280%', period: '7d' },
    },
    tokenomics: {
      supply: '100M / 100M',
      supplyPct: 100,
      inflation: '0% (fixed supply)',
      staked: 'N/A',
      topHolders: '28.6%',
      vestingNote: 'Fixed supply, no inflation. Team tokens locked 12 months with 18-month linear vest. No VC unlock cliffs.',
    },
    team: {
      founders: 'Anon team (doxxed to advisors)',
      org: 'Spectre AI Labs',
      headcount: '~12 core contributors',
      backers: ['Community-funded', 'Angel investors', 'Strategic DeFi partners'],
      audits: ['Smart contract audit (pending)', 'Terminal security review'],
      auditStatus: 'In progress',
    },
    moat: {
      description: 'First-mover in AI-native trading terminals. Proprietary intelligence layer combining real-time Codex data, whale wallet tracking, institutional scoring, and AI agent analysis - a UX moat competitors would need years to replicate.',
      factors: [
        { name: 'Product-Market Fit', score: 88 },
        { name: 'AI Integration Depth', score: 92 },
        { name: 'UX / Design Quality', score: 90 },
        { name: 'Data Moat', score: 78 },
      ],
    },
    valuation: {
      fdv: '$48M',
      mcapRevenue: 'Pre-revenue',
      mcapTvl: 'N/A',
      peerAvg: '$200M+ (AI agent tokens)',
      verdict: 'Significant discount to AI agent peers (VIRTUAL, AI16Z, GRIFFAIN). Working product with growing user base vs. vaporware competitors. Terminal V2 + AI agent trading could catalyze 4-5x re-rate.',
    },
  },
  {
    id: 'p1',
    symbol: 'SOL',
    name: 'Solana',
    tagline: 'The iOS of Crypto',
    comparable: 'What iOS did for mobile, Solana does for on-chain consumer apps',
    sector: 'Infrastructure',
    stage: 'Growth',
    problem: 'Ethereum is too slow and expensive for consumer-scale applications. Users shouldn\'t need to think about gas fees or wait for confirmations.',
    solution: 'Sub-second finality, sub-cent fees, and 65,000 TPS - a blockchain that feels like a web app. Solana makes crypto invisible to the end user.',
    traction: {
      aum: { value: '$78B', label: 'Market Cap (AUM)', change: '+142%', period: 'YoY' },
      users: { value: '1.2M', label: 'Active Wallets (DAU)', change: '+89%', period: 'YoY' },
      revenue: { value: '$420M', label: 'Annual Fee Revenue', change: '+310%', period: 'YoY' },
      gmv: { value: '$8.2B', label: 'Daily DEX Volume (GMV)', change: '+225%', period: 'YoY' },
    },
    tokenomics: {
      supply: '590M / 700M',
      supplyPct: 84,
      inflation: '5.2% (declining)',
      staked: '67.4%',
      topHolders: '18.2%',
      vestingNote: 'Major VC unlocks complete. No cliff events in next 12 months.',
    },
    team: {
      founders: 'Anatoly Yakovenko (ex-Qualcomm), Raj Gokal',
      org: 'Solana Labs + Solana Foundation',
      headcount: '~200 core contributors',
      backers: ['a16z', 'Polychain', 'Multicoin', 'Jump'],
      audits: ['OtterSec', 'Neodyme', 'Kudelski'],
      auditStatus: 'Continuous',
    },
    moat: {
      description: 'Network effects + developer ecosystem + Firedancer multi-client architecture. Only L1 with viable consumer-scale throughput.',
      factors: [
        { name: 'Developer Ecosystem', score: 92 },
        { name: 'Liquidity Depth', score: 88 },
        { name: 'Network Effects', score: 85 },
        { name: 'Technical Moat', score: 78 },
      ],
    },
    valuation: {
      fdv: '$110B',
      mcapRevenue: '185x',
      mcapTvl: '8.2x',
      peerAvg: '320x P/Rev',
      verdict: 'Trading at discount to peer average on revenue multiple. Firedancer catalyst not priced in.',
    },
  },
  {
    id: 'p2',
    symbol: 'AAVE',
    name: 'Aave',
    tagline: 'The JPMorgan of DeFi',
    comparable: 'What JPMorgan is to traditional lending, Aave is to on-chain capital markets',
    sector: 'DeFi',
    stage: 'Mature',
    problem: 'Traditional lending requires intermediaries, credit checks, and days of settlement. Capital sits idle in bank accounts earning sub-inflation yields.',
    solution: 'Permissionless, algorithmic lending and borrowing. Deposit collateral, borrow instantly. No credit check, no paperwork, 24/7 global access.',
    traction: {
      aum: { value: '$12.8B', label: 'Total Value Locked (AUM)', change: '+84%', period: 'YoY' },
      users: { value: '198K', label: 'Unique Depositors', change: '+46%', period: 'YoY' },
      revenue: { value: '$52M', label: 'Annual Protocol Revenue', change: '+120%', period: 'YoY' },
      gmv: { value: '$1.4B', label: 'Daily Borrow Volume', change: '+65%', period: 'YoY' },
    },
    tokenomics: {
      supply: '16M / 16M',
      supplyPct: 100,
      inflation: '0% (fully diluted)',
      staked: '34.2%',
      topHolders: '22.8%',
      vestingNote: 'Fully diluted. No upcoming unlocks. Fee switch vote imminent.',
    },
    team: {
      founders: 'Stani Kulechov',
      org: 'Aave Labs + Aave DAO',
      headcount: '~80 core + DAO contributors',
      backers: ['a16z', 'Framework', 'Variant', 'Blockchain Capital'],
      audits: ['Trail of Bits', 'OpenZeppelin', 'SigmaPrime', 'Certora'],
      auditStatus: 'Continuous + formal verification',
    },
    moat: {
      description: 'Deepest liquidity pools in DeFi + 4-year track record of zero exploits on core protocol. Brand is synonymous with DeFi lending.',
      factors: [
        { name: 'Liquidity Depth', score: 96 },
        { name: 'Security Record', score: 94 },
        { name: 'Brand / Trust', score: 90 },
        { name: 'Multi-chain Presence', score: 82 },
      ],
    },
    valuation: {
      fdv: '$4.2B',
      mcapRevenue: '81x',
      mcapTvl: '0.33x',
      peerAvg: '120x P/Rev',
      verdict: 'Cheapest DeFi blue chip on P/Rev. Fee switch could drive 2-3x re-rate. MCap/TVL far below 1x = value.',
    },
  },
  {
    id: 'p3',
    symbol: 'ONDO',
    name: 'Ondo Finance',
    tagline: 'The BlackRock of DeFi',
    comparable: 'What BlackRock did for ETFs, Ondo does for tokenized real-world assets',
    sector: 'RWA',
    stage: 'Early Growth',
    problem: 'Trillions in treasuries, bonds, and real-world assets are locked behind institutional walls. Retail and DeFi users can\'t access yield on US treasuries 24/7.',
    solution: 'Tokenized US Treasuries (USDY) and institutional-grade financial products on-chain. Regulated, SEC-compliant, and composable with DeFi protocols.',
    traction: {
      aum: { value: '$620M', label: 'Tokenized Assets (AUM)', change: '+1,240%', period: 'YoY' },
      users: { value: '14.5K', label: 'Unique Holders', change: '+380%', period: 'YoY' },
      revenue: { value: '$18M', label: 'Annual Management Fees', change: '+890%', period: 'YoY' },
      gmv: { value: '$45M', label: 'Daily Trading Volume', change: '+420%', period: 'YoY' },
    },
    tokenomics: {
      supply: '10B / 10B',
      supplyPct: 100,
      inflation: '0%',
      staked: 'N/A',
      topHolders: '42.1%',
      vestingNote: 'Team + investor tokens partially locked. Next unlock: Q3 2026 (8% of supply).',
    },
    team: {
      founders: 'Nathan Allman (ex-Goldman Sachs)',
      org: 'Ondo Finance Inc.',
      headcount: '~45 team',
      backers: ['Founders Fund', 'Pantera', 'Coinbase Ventures', 'Tiger Global'],
      audits: ['C4', 'Code4rena', 'Quantstamp'],
      auditStatus: 'Per-product',
    },
    moat: {
      description: 'First-mover in regulated RWA tokenization. BlackRock partnership and SEC-compliant structure create regulatory moat competitors can\'t easily replicate.',
      factors: [
        { name: 'Regulatory Moat', score: 90 },
        { name: 'Institutional Partners', score: 88 },
        { name: 'First-Mover Advantage', score: 85 },
        { name: 'Product-Market Fit', score: 82 },
      ],
    },
    valuation: {
      fdv: '$2.1B',
      mcapRevenue: '117x',
      mcapTvl: '3.4x',
      peerAvg: '150x P/Rev',
      verdict: 'Below peer avg on P/Rev. TAM is $24T+ (US treasuries alone). If even 1% tokenizes, ONDO\'s AUM 40x from here.',
    },
  },
]

/* ───────────────────────────────────────────────────────────────
 * Data-derived pitch builder
 * Mirrors packages/server/agents/pitchDeckAgent.js so a deck built
 * from raw project data is visually identical to an AI-generated one
 * (and the AI merge layers cleanly on top). Pure - no React, no fetch.
 * ─────────────────────────────────────────────────────────────── */

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null }

/* change24h arrives as a fraction (-0.09 = -9%) from the trending feed;
 * change7d (tvlChange7d) arrives already as a percent. Mirror the agent. */
function toPct(v) {
  const n = num(v)
  if (n == null) return null
  return Math.abs(n) < 100 ? n * 100 : n
}

function fmtCompactUsd(n) {
  const v = num(n)
  if (v == null) return null
  const abs = Math.abs(v)
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtPct(n) {
  const v = num(n)
  if (v == null) return null
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(0)}%`
}

/* Bounded 0-100 score helper for derived moat factors */
function clamp100(v) {
  const n = num(v)
  if (n == null) return 60
  return Math.max(0, Math.min(100, Math.round(n)))
}

const DERIVED_DEALFLOW_STAGE = { sourced: 'Seed', diligence: 'Seed', conviction: 'Early Growth', positioned: 'Growth' }

/**
 * mapProjectToPitch(project) -> object matching the FALLBACK_PITCHES schema.
 * Real numbers where derivable; honest 'Unknown' / '-' placeholders for genuine
 * gaps. Defensive against missing fields (dynamic data has gaps static didn't).
 */
function mapProjectToPitch(project) {
  const p = project || {}
  const symbol = String(p.symbol || '').replace(/^\$/, '').toUpperCase() || '-'
  const name = p.name || p.symbol || 'Unknown'
  const sector = p.sector || p.category || 'DeFi'
  const chain = p.chain || (Array.isArray(p.chains) ? p.chains[0] : null) || null

  const mcap = num(p.mcap)
  const fdv = num(p.fdv)
  const tvl = num(p.tvl)
  const volume24h = num(p.volume24h)
  const liquidity = num(p.liquidity)
  const revenue24h = num(p.revenue24h)
  const change24h = toPct(p.change24h)
  // tvlChange7d is the available 7d series; change7d is honored if the feed adds it
  const change7d = p.change7d != null ? num(p.change7d) : num(p.tvlChange7d)
  const ageDays = num(p.ageDays)
  const auditCount = num(p.audits) || 0
  const backers = Array.isArray(p.backers) ? p.backers.filter(Boolean) : []
  const annualRev = revenue24h != null ? revenue24h * 365 : null

  /* ── Cover ── */
  const tagline = `The ${sector} play on ${chain || 'chain'}`
  const comparable = `An emerging ${sector} protocol${chain ? ` building on ${chain}` : ''}.`
  const stage = DERIVED_DEALFLOW_STAGE[p.dealFlowStage] || 'Early Growth'

  /* ── Problem / Solution (category-templated factual sentences) ── */
  const problem = `${name} operates in the ${sector} segment${chain ? ` on ${chain}` : ''}, where capital efficiency, liquidity depth, and trust are the constraints that gate adoption. Emerging protocols here compete against entrenched incumbents for the same on-chain flow.`
  const solution = `${name} addresses this by ${tvl != null ? `securing ${fmtCompactUsd(tvl)} in total value locked` : 'building protocol-owned liquidity'}${volume24h != null ? ` and routing ${fmtCompactUsd(volume24h)} of daily volume` : ''}, carving out share in the ${sector} category through on-chain execution.`

  /* ── Traction (aum = mcap, gmv = volume24h; users/revenue real or Unknown) ── */
  const traction = {
    aum: {
      value: fmtCompactUsd(mcap) || fmtCompactUsd(tvl) || '-',
      label: mcap != null ? 'Market Cap' : (tvl != null ? 'Total Value Locked' : 'Market Cap'),
      change: change7d != null ? fmtPct(change7d) : '',
      period: change7d != null ? '7d' : '',
    },
    revenue: annualRev != null
      ? { value: fmtCompactUsd(annualRev) || '-', label: 'Annual Revenue (est.)', change: '', period: 'annualized' }
      : { value: 'Unknown', label: 'Protocol Revenue', change: '', period: '' },
    users: { value: 'Unknown', label: 'Token Holders', change: '', period: '' },
    gmv: {
      value: fmtCompactUsd(volume24h) || '-',
      label: 'Daily Volume (GMV)',
      change: change24h != null ? fmtPct(change24h) : '',
      period: change24h != null ? '24h' : '',
    },
  }

  /* ── Tokenomics (partial; Unknown when no token-supply feed) ── */
  const tokenomics = {
    supply: 'Unknown',
    supplyPct: (mcap != null && fdv != null && fdv > 0) ? clamp100((mcap / fdv) * 100) : 100,
    inflation: 'Unknown',
    staked: 'N/A',
    topHolders: 'Unknown',
    vestingNote: 'Supply and vesting schedule not fully disclosed on-chain.',
  }

  /* ── Team (backers + audits real; founders/org/headcount Unknown) ── */
  let audits
  if (auditCount > 0) audits = [`${auditCount} audit${auditCount > 1 ? 's' : ''} on record`]
  else audits = ['No audits on record']
  const team = {
    founders: 'Unknown',
    org: name,
    headcount: 'Unknown',
    backers: backers.length ? backers.map(String) : ['Not disclosed'],
    audits,
    auditStatus: auditCount > 0 ? 'Audited' : 'Unaudited',
  }

  /* ── Moat (4 factors derived from liquidity / tvl / age scores 0-100) ── */
  const liqScore = liquidity != null
    ? clamp100(20 + 15 * Math.log10(Math.max(liquidity, 1) / 1e4))
    : 55
  const tvlScore = tvl != null
    ? clamp100(20 + 15 * Math.log10(Math.max(tvl, 1) / 1e5))
    : 55
  const ageScore = ageDays != null ? clamp100(40 + ageDays / 12) : 55
  const momentumScore = change7d != null ? clamp100(60 + change7d) : 55
  const moat = {
    description: `Emerging ${sector} protocol${chain ? ` on ${chain}` : ''}. Competitive position is anchored by ${tvl != null ? `${fmtCompactUsd(tvl)} of TVL` : 'protocol liquidity'} and on-chain execution rather than brand.`,
    factors: [
      { name: 'Liquidity Depth', score: liqScore },
      { name: 'TVL Scale', score: tvlScore },
      { name: 'Track Record', score: ageScore },
      { name: 'Momentum', score: momentumScore },
    ],
  }

  /* ── Valuation (real ratios where inputs exist; verdict data-derived) ── */
  const mcapRevenue = (mcap != null && annualRev != null && annualRev > 0)
    ? `${(mcap / annualRev).toFixed(0)}x`
    : (revenue24h != null ? 'N/A' : 'Pre-revenue')
  const mcapTvl = (mcap != null && tvl != null && tvl > 0)
    ? `${(mcap / tvl).toFixed(2)}x`
    : 'N/A'
  const verdictParts = []
  if (mcap != null && tvl != null && tvl > 0) {
    const ratio = mcap / tvl
    verdictParts.push(ratio < 1
      ? `Trades below 1x MCap/TVL (${ratio.toFixed(2)}x) - the market is valuing it under the capital it secures.`
      : `Trades at ${ratio.toFixed(2)}x MCap/TVL, pricing in growth beyond current locked capital.`)
  }
  if (change7d != null) {
    verdictParts.push(`TVL is ${change7d >= 0 ? 'up' : 'down'} ${Math.abs(change7d).toFixed(1)}% over 7 days.`)
  }
  if (!verdictParts.length) verdictParts.push(`Valuation context is thin - treat as an early, high-risk ${sector} position.`)
  const valuation = {
    fdv: fmtCompactUsd(fdv) || fmtCompactUsd(mcap) || '-',
    mcapRevenue,
    mcapTvl,
    peerAvg: 'N/A',
    verdict: verdictParts.join(' '),
  }

  const pitch = {
    id: `p-${String(project?.id || project?.address || symbol || 'x').toLowerCase()}`,
    symbol,
    name,
    tagline,
    comparable,
    sector,
    stage,
    problem,
    solution,
    traction,
    tokenomics,
    team,
    moat,
    valuation,
  }
  if (p.address) pitch.address = p.address
  return pitch
}

/**
 * Deep-merge an AI pitch deck over a data-derived one: AI prose wins, but the
 * headline numbers (already injected by the backend from project data) stay.
 * Both are the same schema, so a shallow-with-nested-object merge suffices.
 * Guards against the AI object being partial.
 */
function mergeAiPitch(base, ai) {
  if (!ai || typeof ai !== 'object') return base
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  return {
    ...base,
    ...ai,
    id: base.id, // keep stable React key
    traction: obj(ai.traction) ? { ...base.traction, ...ai.traction } : base.traction,
    tokenomics: obj(ai.tokenomics) ? { ...base.tokenomics, ...ai.tokenomics } : base.tokenomics,
    team: obj(ai.team) ? { ...base.team, ...ai.team } : base.team,
    moat: obj(ai.moat) ? { ...base.moat, ...ai.moat } : base.moat,
    valuation: obj(ai.valuation) ? { ...base.valuation, ...ai.valuation } : base.valuation,
  }
}

/* ── SVG Donut Chart (for tokenomics) ── */
function DonutChart({ pct, label, size = 120, strokeWidth = 10 }) {
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <div className="tpd-pres-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="url(#donutGrad)" strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="tpd-pres-donut-fill"
        />
        <defs>
          <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(245,245,247,0.8)" />
            <stop offset="100%" stopColor="rgba(200,200,210,0.5)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="tpd-pres-donut-center">
        <span className="tpd-pres-donut-pct">{pct}%</span>
        <span className="tpd-pres-donut-label">{label}</span>
      </div>
    </div>
  )
}

/* ── Radial Score Gauge (for moat factors) ── */
function ScoreGauge({ score, name, color }) {
  const r = 36
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  return (
    <div className="tpd-pres-gauge">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          transform="rotate(-90 44 44)"
          className="tpd-pres-gauge-fill"
        />
      </svg>
      <div className="tpd-pres-gauge-center">
        <span className="tpd-pres-gauge-score">{score}</span>
      </div>
      <span className="tpd-pres-gauge-name">{name}</span>
    </div>
  )
}

/* ── Presentation Slide Renderer ── */
function PresentationSlide({ pitch, slideIndex, logo }) {
  switch (slideIndex) {
    /* ── Cover ── */
    case 0:
      return (
        <div className="tpd-pres-content tpd-pres-content--cover">
          <div className="tpd-pres-cover-bg" aria-hidden="true" />
          <div className="tpd-pres-cover-main">
            {logo ? (
              <img className="tpd-pres-cover-logo" src={logo} alt={pitch.symbol} />
            ) : (
              <div className="tpd-pres-cover-logo tpd-pres-cover-logo--fallback">{(pitch.symbol || '?').charAt(0)}</div>
            )}
            <h2 className="tpd-pres-cover-name">{pitch.name || pitch.symbol || '-'}</h2>
            <span className="tpd-pres-cover-tagline">{pitch.tagline || ''}</span>
            <p className="tpd-pres-cover-comparable">{pitch.comparable || ''}</p>
            <div className="tpd-pres-cover-badges">
              {pitch.stage && <span className="tpd-pres-badge tpd-pres-badge--stage">{pitch.stage}</span>}
              {pitch.sector && <span className="tpd-pres-badge tpd-pres-badge--sector">{pitch.sector}</span>}
            </div>
          </div>
        </div>
      )

    /* ── Problem / Solution ── */
    case 1:
      return (
        <div className="tpd-pres-content tpd-pres-content--ps">
          <div className="tpd-pres-ps-card tpd-pres-ps-card--problem">
            <div className="tpd-pres-ps-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            </div>
            <h3 className="tpd-pres-ps-title">The Problem</h3>
            <p className="tpd-pres-ps-text">{pitch.problem || 'Not disclosed.'}</p>
          </div>
          <div className="tpd-pres-ps-arrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
          <div className="tpd-pres-ps-card tpd-pres-ps-card--solution">
            <div className="tpd-pres-ps-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
              </svg>
            </div>
            <h3 className="tpd-pres-ps-title tpd-pres-ps-title--accent">The Solution</h3>
            <p className="tpd-pres-ps-text">{pitch.solution || 'Not disclosed.'}</p>
          </div>
        </div>
      )

    /* ── Traction ── */
    case 2:
      return (
        <div className="tpd-pres-content tpd-pres-content--traction">
          <div className="tpd-pres-traction-grid">
            {Object.values(pitch.traction || {}).map((kpi, i) => (
              <div key={i} className="tpd-pres-kpi">
                <div className="tpd-pres-kpi-glow" />
                <span className="tpd-pres-kpi-value">{kpi?.value || '-'}</span>
                <span className="tpd-pres-kpi-label">{kpi?.label || ''}</span>
                {(kpi?.change || kpi?.period) && (
                  <span className="tpd-pres-kpi-change">
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 10V2M2 5l4-3 4 3" />
                    </svg>
                    {kpi?.change} {kpi?.period}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )

    /* ── Tokenomics ── */
    case 3:
      return (
        <div className="tpd-pres-content tpd-pres-content--tokenomics">
          <div className="tpd-pres-tokenomics-layout">
            <DonutChart pct={Number.isFinite(pitch.tokenomics?.supplyPct) ? pitch.tokenomics.supplyPct : 100} label="Circulating" size={140} strokeWidth={12} />
            <div className="tpd-pres-tokenomics-stats">
              <div className="tpd-pres-stat-row">
                <span className="tpd-pres-stat-key">Supply</span>
                <span className="tpd-pres-stat-val">{pitch.tokenomics?.supply || 'Unknown'}</span>
              </div>
              <div className="tpd-pres-stat-row">
                <span className="tpd-pres-stat-key">Inflation</span>
                <span className="tpd-pres-stat-val">{pitch.tokenomics?.inflation || 'Unknown'}</span>
              </div>
              <div className="tpd-pres-stat-row">
                <span className="tpd-pres-stat-key">Staked</span>
                <span className="tpd-pres-stat-val">{pitch.tokenomics?.staked || 'N/A'}</span>
              </div>
              <div className="tpd-pres-stat-row">
                <span className="tpd-pres-stat-key">Top 10 Holders</span>
                <span className="tpd-pres-stat-val">{pitch.tokenomics?.topHolders || 'Unknown'}</span>
              </div>
            </div>
          </div>
          {pitch.tokenomics?.vestingNote && (
            <div className="tpd-pres-tokenomics-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              <span>{pitch.tokenomics.vestingNote}</span>
            </div>
          )}
        </div>
      )

    /* ── Team & Backers ── */
    case 4:
      return (
        <div className="tpd-pres-content tpd-pres-content--team">
          <div className="tpd-pres-team-top">
            <div className="tpd-pres-team-card">
              <svg className="tpd-pres-team-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              <span className="tpd-pres-team-label">Founders</span>
              <span className="tpd-pres-team-value">{pitch.team?.founders || 'Unknown'}</span>
            </div>
            <div className="tpd-pres-team-card">
              <svg className="tpd-pres-team-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18M3 7v1a3 3 0 006 0V7m0 1a3 3 0 006 0V7m0 1a3 3 0 006 0V7H3l2-4h14l2 4" />
              </svg>
              <span className="tpd-pres-team-label">Organization</span>
              <span className="tpd-pres-team-value">{pitch.team?.org || pitch.name || '-'}</span>
            </div>
            <div className="tpd-pres-team-card">
              <svg className="tpd-pres-team-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
              <span className="tpd-pres-team-label">Team Size</span>
              <span className="tpd-pres-team-value">{pitch.team?.headcount || 'Unknown'}</span>
            </div>
          </div>
          <div className="tpd-pres-team-bottom">
            <div className="tpd-pres-pills-group">
              <span className="tpd-pres-pills-label">Investors</span>
              <div className="tpd-pres-pills">
                {(pitch.team?.backers || []).map((b, i) => (
                  <span key={i} className="tpd-pres-pill tpd-pres-pill--backer">{b}</span>
                ))}
              </div>
            </div>
            <div className="tpd-pres-pills-group">
              <span className="tpd-pres-pills-label">Security Audits</span>
              <div className="tpd-pres-pills">
                {(pitch.team?.audits || []).map((a, i) => (
                  <span key={i} className="tpd-pres-pill tpd-pres-pill--audit">{a}</span>
                ))}
              </div>
              {pitch.team?.auditStatus && <span className="tpd-pres-audit-status">{pitch.team.auditStatus}</span>}
            </div>
          </div>
        </div>
      )

    /* ── Competitive Moat ── */
    case 5: {
      const colors = ['#f5f5f7', '#10B981', '#06B6D4', '#FBBF24']
      return (
        <div className="tpd-pres-content tpd-pres-content--moat">
          <p className="tpd-pres-moat-desc">{pitch.moat?.description || ''}</p>
          <div className="tpd-pres-moat-gauges">
            {(pitch.moat?.factors || []).map((f, i) => (
              <ScoreGauge key={i} score={Number.isFinite(f?.score) ? f.score : 0} name={f?.name || '-'} color={colors[i % colors.length]} />
            ))}
          </div>
        </div>
      )
    }

    /* ── Valuation ── */
    case 6:
      return (
        <div className="tpd-pres-content tpd-pres-content--valuation">
          <div className="tpd-pres-val-hero">
            <span className="tpd-pres-val-hero-label">Fully Diluted Valuation</span>
            <span className="tpd-pres-val-hero-value">{pitch.valuation?.fdv || '-'}</span>
          </div>
          <div className="tpd-pres-val-metrics">
            <div className="tpd-pres-val-metric">
              <span className="tpd-pres-val-metric-val">{pitch.valuation?.mcapRevenue || '-'}</span>
              <span className="tpd-pres-val-metric-key">MCap / Revenue</span>
            </div>
            <div className="tpd-pres-val-metric">
              <span className="tpd-pres-val-metric-val">{pitch.valuation?.mcapTvl || '-'}</span>
              <span className="tpd-pres-val-metric-key">MCap / TVL</span>
            </div>
            <div className="tpd-pres-val-metric">
              <span className="tpd-pres-val-metric-val">{pitch.valuation?.peerAvg || '-'}</span>
              <span className="tpd-pres-val-metric-key">Peer Average</span>
            </div>
          </div>
          {pitch.valuation?.verdict && (
            <div className="tpd-pres-val-verdict">
              <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
              <span>{pitch.valuation.verdict}</span>
            </div>
          )}
        </div>
      )

    default:
      return null
  }
}


function TokenPitchDeck({ activeSymbol, livePrices = {}, projects, aiPitches }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [viewMode, setViewMode] = useState('cards') // 'cards' | 'slides'
  const [slideIndex, setSlideIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const containerRef = useRef(null)
  const totalSlides = SLIDE_LABELS.length

  /* Build the deck list:
   *   1. projects.map(mapProjectToPitch)  - real on-chain data
   *   2. merge the AI deck (aiPitches[symbol]) over it - AI prose wins, numbers stay
   *   3. fall back to the static FALLBACK_PITCHES when no projects arrive
   *   4. overlay live CoinGecko prices (mcap -> aum, fdv -> valuation.fdv)
   */
  const pitches = useMemo(() => {
    const ai = (aiPitches && typeof aiPitches === 'object') ? aiPitches : {}

    let base
    if (Array.isArray(projects) && projects.length > 0) {
      base = projects
        .map(mapProjectToPitch)
        .filter(p => p && p.symbol && p.symbol !== '-')
        .map(p => mergeAiPitch(p, ai[p.symbol]))
    } else {
      base = FALLBACK_PITCHES
    }
    if (!base || base.length === 0) base = FALLBACK_PITCHES

    /* Live-price overlay - keep the most real-time market cap / FDV on top */
    if (!livePrices || Object.keys(livePrices).length === 0) return base
    return base.map(pitch => {
      const live = livePrices[pitch.symbol]
      if (!live) return pitch
      const aum = pitch.traction?.aum || {}
      return {
        ...pitch,
        traction: {
          ...pitch.traction,
          aum: { ...aum, value: formatMcap(live.mcap) || aum.value },
        },
        valuation: {
          ...pitch.valuation,
          fdv: formatMcap(live.fdv) || pitch.valuation?.fdv,
        },
      }
    })
  }, [projects, aiPitches, livePrices])

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true) },
      { threshold: 0.1 }
    )
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  /* Auto-select token tab when activeSymbol changes */
  useEffect(() => {
    if (!activeSymbol) return
    const idx = pitches.findIndex(p => p?.symbol === activeSymbol)
    if (idx >= 0) {
      setActiveIndex(idx)
      setSlideIndex(0)
    }
  }, [activeSymbol, pitches])

  /* Keep activeIndex in range when the deck list changes (projects <-> fallback) */
  useEffect(() => {
    if (activeIndex > pitches.length - 1) {
      setActiveIndex(0)
      setSlideIndex(0)
    }
  }, [pitches.length, activeIndex])

  /* Reset slide index when switching tokens */
  const handleTokenChange = useCallback((i) => {
    setActiveIndex(i)
    setSlideIndex(0)
  }, [])

  /* Keyboard navigation for slides mode */
  useEffect(() => {
    if (viewMode !== 'slides') return
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSlideIndex(prev => Math.min(prev + 1, totalSlides - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSlideIndex(prev => Math.max(prev - 1, 0))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [viewMode, totalSlides])

  const pitch = pitches[activeIndex] || pitches[0]
  if (!pitch) return null
  const logo = getTokenLogo(pitch.symbol)

  return (
    <div className={`tpd ${isVisible ? 'is-visible' : ''}`} ref={containerRef}>
      {/* Top bar: token tabs + view mode toggle */}
      <div className="tpd-topbar">
        <div className="tpd-tabs">
          {pitches.map((p, i) => {
            const pLogo = getTokenLogo(p.symbol)
            return (
              <button
                key={p.id || p.symbol || i}
                className={`tpd-tab ${i === activeIndex ? 'is-active' : ''}`}
                onClick={() => handleTokenChange(i)}
              >
                {pLogo ? (
                  <img className="tpd-tab-logo" src={pLogo} alt={p.symbol} />
                ) : (
                  <span className="tpd-tab-logo tpd-tab-logo--fallback">{(p.symbol || '?').charAt(0)}</span>
                )}
                <span className="tpd-tab-symbol">{p.symbol || '-'}</span>
                <span className="tpd-tab-tagline">{p.tagline || ''}</span>
              </button>
            )
          })}
        </div>
        <div className="tpd-view-toggle">
          <button
            className={`tpd-view-btn ${viewMode === 'cards' ? 'is-active' : ''}`}
            onClick={() => setViewMode('cards')}
            title="Card view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16M4 10h16M4 15h16M4 20h16" />
            </svg>
            Cards
          </button>
          <button
            className={`tpd-view-btn ${viewMode === 'slides' ? 'is-active' : ''}`}
            onClick={() => setViewMode('slides')}
            title="Presentation view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
            Slides
          </button>
        </div>
      </div>

      {/* ═══ Cards View ═══ */}
      {viewMode === 'cards' && (
        <div className="tpd-deck" key={pitch.id}>
          {/* ── Slide 1: Cover ── */}
          <div className="tpd-slide tpd-slide--cover">
            <div className="tpd-cover-left">
              {logo ? (
                <img className="tpd-cover-logo" src={logo} alt={pitch.symbol} />
              ) : (
                <div className="tpd-cover-logo tpd-cover-logo--fallback">{(pitch.symbol || '?').charAt(0)}</div>
              )}
              <div className="tpd-cover-identity">
                <h3 className="tpd-cover-name">{pitch.name || pitch.symbol || '-'}</h3>
                <span className="tpd-cover-tagline">{pitch.tagline || ''}</span>
              </div>
            </div>
            <div className="tpd-cover-right">
              {pitch.stage && <span className="tpd-cover-stage">{pitch.stage}</span>}
              {pitch.sector && <span className="tpd-cover-sector">{pitch.sector}</span>}
            </div>
          </div>

          {/* ── Slide 2: Problem / Solution ── */}
          <div className="tpd-slide tpd-slide--ps">
            <div className="tpd-ps-half tpd-ps-half--problem">
              <span className="tpd-slide-label">The Problem</span>
              <p className="tpd-ps-text">{pitch.problem || 'Not disclosed.'}</p>
            </div>
            <div className="tpd-ps-divider" />
            <div className="tpd-ps-half tpd-ps-half--solution">
              <span className="tpd-slide-label tpd-slide-label--accent">The Solution</span>
              <p className="tpd-ps-text">{pitch.solution || 'Not disclosed.'}</p>
            </div>
          </div>

          {/* ── Slide 3: Traction KPIs ── */}
          <div className="tpd-slide tpd-slide--traction">
            <span className="tpd-slide-label">Traction</span>
            <p className="tpd-comparable">{pitch.comparable || ''}</p>
            <div className="tpd-kpi-grid">
              {Object.values(pitch.traction || {}).map((kpi, i) => (
                <div key={i} className="tpd-kpi">
                  <span className="tpd-kpi-value">{kpi?.value || '-'}</span>
                  <span className="tpd-kpi-label">{kpi?.label || ''}</span>
                  {(kpi?.change || kpi?.period) && (
                    <span className="tpd-kpi-change is-bull">{kpi?.change} <span className="tpd-kpi-period">{kpi?.period}</span></span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Slide 4: Tokenomics ── */}
          <div className="tpd-slide tpd-slide--tokenomics">
            <span className="tpd-slide-label">Tokenomics</span>
            <div className="tpd-tokenomics-grid">
              <div className="tpd-tokenomics-item">
                <span className="tpd-tokenomics-key">Circulating / Max Supply</span>
                <span className="tpd-tokenomics-val">{pitch.tokenomics?.supply || 'Unknown'}</span>
                <div className="tpd-supply-bar">
                  <div className="tpd-supply-fill" style={{ width: `${Number.isFinite(pitch.tokenomics?.supplyPct) ? pitch.tokenomics.supplyPct : 100}%` }} />
                </div>
                <span className="tpd-supply-pct">{Number.isFinite(pitch.tokenomics?.supplyPct) ? pitch.tokenomics.supplyPct : 100}% circulating</span>
              </div>
              <div className="tpd-tokenomics-row">
                <div className="tpd-tokenomics-item">
                  <span className="tpd-tokenomics-key">Inflation Rate</span>
                  <span className="tpd-tokenomics-val">{pitch.tokenomics?.inflation || 'Unknown'}</span>
                </div>
                <div className="tpd-tokenomics-item">
                  <span className="tpd-tokenomics-key">Staked</span>
                  <span className="tpd-tokenomics-val">{pitch.tokenomics?.staked || 'N/A'}</span>
                </div>
                <div className="tpd-tokenomics-item">
                  <span className="tpd-tokenomics-key">Top 10 Holders</span>
                  <span className="tpd-tokenomics-val">{pitch.tokenomics?.topHolders || 'Unknown'}</span>
                </div>
              </div>
              {pitch.tokenomics?.vestingNote && (
                <div className="tpd-tokenomics-note">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                  <span>{pitch.tokenomics.vestingNote}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Slide 5: Team & Backers ── */}
          <div className="tpd-slide tpd-slide--team">
            <span className="tpd-slide-label">Team & Backers</span>
            <div className="tpd-team-grid">
              <div className="tpd-team-item">
                <span className="tpd-team-key">Founders</span>
                <span className="tpd-team-val">{pitch.team?.founders || 'Unknown'}</span>
              </div>
              <div className="tpd-team-item">
                <span className="tpd-team-key">Organization</span>
                <span className="tpd-team-val">{pitch.team?.org || pitch.name || '-'}</span>
              </div>
              <div className="tpd-team-item">
                <span className="tpd-team-key">Team Size</span>
                <span className="tpd-team-val">{pitch.team?.headcount || 'Unknown'}</span>
              </div>
            </div>
            <div className="tpd-team-pills-section">
              <div className="tpd-team-pills-group">
                <span className="tpd-team-pills-label">Investors</span>
                <div className="tpd-team-pills">
                  {(pitch.team?.backers || []).map((b, i) => (
                    <span key={i} className="tpd-pill tpd-pill--backer">{b}</span>
                  ))}
                </div>
              </div>
              <div className="tpd-team-pills-group">
                <span className="tpd-team-pills-label">Auditors</span>
                <div className="tpd-team-pills">
                  {(pitch.team?.audits || []).map((a, i) => (
                    <span key={i} className="tpd-pill tpd-pill--audit">{a}</span>
                  ))}
                </div>
                {pitch.team?.auditStatus && <span className="tpd-audit-status">{pitch.team.auditStatus}</span>}
              </div>
            </div>
          </div>

          {/* ── Slide 6: Competitive Moat ── */}
          <div className="tpd-slide tpd-slide--moat">
            <span className="tpd-slide-label">Competitive Moat</span>
            <p className="tpd-moat-desc">{pitch.moat?.description || ''}</p>
            <div className="tpd-moat-factors">
              {(pitch.moat?.factors || []).map((f, i) => {
                const score = Number.isFinite(f?.score) ? f.score : 0
                return (
                  <div key={i} className="tpd-moat-factor">
                    <div className="tpd-moat-factor-head">
                      <span className="tpd-moat-factor-name">{f?.name || '-'}</span>
                      <span className="tpd-moat-factor-score">{score}</span>
                    </div>
                    <div className="tpd-moat-bar-track">
                      <div
                        className="tpd-moat-bar-fill"
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Slide 7: Valuation Context ── */}
          <div className="tpd-slide tpd-slide--valuation">
            <span className="tpd-slide-label">Valuation Context</span>
            <div className="tpd-val-grid">
              <div className="tpd-val-item tpd-val-item--primary">
                <span className="tpd-val-key">Fully Diluted Valuation<InfoTip text="Price times total supply, including locked and unvested tokens. Shows the fully-priced value if all tokens were circulating." position="top" /></span>
                <span className="tpd-val-value tpd-val-value--large">{pitch.valuation?.fdv || '-'}</span>
              </div>
              <div className="tpd-val-item">
                <span className="tpd-val-key">MCap / Revenue<InfoTip text="Market cap divided by annual revenue. Lower ratio may indicate the token is undervalued relative to its earnings." position="top" /></span>
                <span className="tpd-val-value">{pitch.valuation?.mcapRevenue || '-'}</span>
              </div>
              <div className="tpd-val-item">
                <span className="tpd-val-key">MCap / TVL<InfoTip text="Market cap divided by Total Value Locked in the protocol. Lower ratio may indicate undervaluation relative to usage." position="top" /></span>
                <span className="tpd-val-value">{pitch.valuation?.mcapTvl || '-'}</span>
              </div>
              <div className="tpd-val-item">
                <span className="tpd-val-key">Peer Average</span>
                <span className="tpd-val-value">{pitch.valuation?.peerAvg || '-'}</span>
              </div>
            </div>
            {pitch.valuation?.verdict && (
              <div className="tpd-val-verdict">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                <span>{pitch.valuation.verdict}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ Slides (Presentation) View ═══ */}
      {viewMode === 'slides' && (
        <div className="tpd-pres" key={`${pitch.id}-pres`}>
          {/* Slide stage */}
          <div className="tpd-pres-stage">
            <div className="tpd-pres-slide-label">
              <span className="tpd-pres-slide-num">{slideIndex + 1} / {totalSlides}</span>
              <span className="tpd-pres-slide-title">{SLIDE_LABELS[slideIndex]}</span>
            </div>
            <div className="tpd-pres-viewport" key={slideIndex}>
              <PresentationSlide pitch={pitch} slideIndex={slideIndex} logo={logo} />
            </div>
          </div>

          {/* Navigation */}
          <div className="tpd-pres-nav">
            <button
              className="tpd-pres-nav-btn"
              onClick={() => setSlideIndex(prev => Math.max(prev - 1, 0))}
              disabled={slideIndex === 0}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="tpd-pres-dots">
              {SLIDE_LABELS.map((label, i) => (
                <button
                  key={i}
                  className={`tpd-pres-dot ${i === slideIndex ? 'is-active' : ''}`}
                  onClick={() => setSlideIndex(i)}
                  title={label}
                />
              ))}
            </div>
            <button
              className="tpd-pres-nav-btn"
              onClick={() => setSlideIndex(prev => Math.min(prev + 1, totalSlides - 1))}
              disabled={slideIndex === totalSlides - 1}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TokenPitchDeck
