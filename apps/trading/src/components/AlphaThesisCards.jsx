/**
 * AlphaThesisCards - "The Research Desk"
 * Goldman research notes meets crypto alpha.
 * Short-form investment thesis cards with:
 *   Bull Case - Bear Case - Key Catalysts - Risk Score - Comparable
 *
 * Glass card design with conviction-colored accents,
 * animated risk pips, and cinematic blur-in entrance.
 *
 * DYNAMIC: maps the live Research Desk `projects` (emerging EVM DeFi-alpha) into
 * the THESES schema via a pure, DATA-DERIVED `mapProjectToThesis()`. When the AI
 * agent has produced a richer thesis for a symbol (`aiTheses[SYMBOL]`), its prose
 * fields are merged OVER the data-derived ones (AI wins for narrative; real
 * numbers always come from the project). Falls back to the static THESES below
 * when `projects` is empty (dev cold start with no bundle).
 */
import React, { useRef, useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getTokenLogo } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './AlphaThesisCards.css'

/* ── Social icon SVG paths ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'], fill: true },
  x: { viewBox: '0 0 24 24', paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'], fill: true },
  discord: { viewBox: '0 0 24 24', paths: ['M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'], fill: true },
  telegram: { viewBox: '0 0 24 24', paths: ['M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'], fill: true },
  github: { viewBox: '0 0 24 24', paths: ['M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'], fill: true },
}

/* ── Static fallback thesis data - extended investor-grade fields.
   DEMOTED to a fallback: rendered only when `projects` is empty (dev cold start
   with no backend bundle). Never delete — it keeps the tab from rendering blank. ── */
const STATIC_THESES = [
  {
    id: 't1',
    symbol: 'SOL',
    name: 'Solana',
    sector: 'Infrastructure',
    comparable: 'The iOS of crypto - consumer-grade L1',
    riskScore: 3,
    timeHorizon: '12-18 months',
    priceTarget: '$280-340',
    conviction: 'High',
    mcap: '$78B', fdv: '$96B', volume24h: '$3.2B', tvl: '$8.4B', chain: 'Solana',
    currentPrice: '$186.40', change24h: 4.1,
    analystNote: 'Firedancer is the single most important catalyst in crypto infrastructure. A successful launch would validate Solana as the only L1 with two independent, production-grade validator clients - a massive resilience upgrade that addresses the primary institutional concern.',
    peerComps: [
      { symbol: 'ETH', mcap: '$380B', metric: 'TVL $62B' },
      { symbol: 'AVAX', mcap: '$14B', metric: 'TVL $1.2B' },
      { symbol: 'APT', mcap: '$4.8B', metric: 'TVL $680M' },
    ],
    bullCase: [
      'Firedancer client 10x throughput - moat deepens',
      'ETF filing creates institutional demand floor',
      'Payments + DePIN adoption driving organic usage',
    ],
    bearCase: [
      'Network outages remain unresolved at scale',
      'ETF rejection dampens institutional narrative',
      'MEV extraction eroding user trust',
    ],
    catalysts: [
      { event: 'Firedancer mainnet launch', timing: 'Q1 2026', impact: 'high' },
      { event: 'SOL ETF decision deadline', timing: 'Mar 2026', impact: 'high' },
      { event: 'Solana Mobile Chapter 2 ship', timing: 'Q2 2026', impact: 'medium' },
    ],
    socials: { website: 'https://solana.com', x: 'https://x.com/solana', discord: 'https://discord.gg/solana', github: 'https://github.com/solana-labs' },
  },
  {
    id: 't2',
    symbol: 'ONDO',
    name: 'Ondo Finance',
    sector: 'RWA',
    comparable: 'The BlackRock of DeFi - institutional RWA tokenization',
    riskScore: 4,
    timeHorizon: '6-12 months',
    priceTarget: '$3.50-5.00',
    conviction: 'High',
    mcap: '$2.1B', fdv: '$6.8B', volume24h: '$156M', tvl: '$620M', chain: 'Ethereum + Solana',
    currentPrice: '$1.42', change24h: 8.3,
    analystNote: 'ONDO is the institutional gateway into tokenized real-world assets. The SEC filing for their Treasury product will be a binary event - approval opens the floodgates to a $24T addressable market. FDV/TVL ratio of 11x suggests the market is pricing in significant growth.',
    peerComps: [
      { symbol: 'MKR', mcap: '$2.4B', metric: 'RWA $3.2B' },
      { symbol: 'MAPLE', mcap: '$180M', metric: 'Loans $420M' },
      { symbol: 'CFG', mcap: '$520M', metric: 'RWA $280M' },
    ],
    bullCase: [
      'Treasury tokenization = massive TAM ($24T market)',
      'BlackRock partnership validates institutional thesis',
      'First-mover in regulated RWA with SEC-compliant products',
    ],
    bearCase: [
      'Regulatory risk - SEC classification uncertainty',
      'BlackRock builds in-house, bypassing ONDO',
      'Limited moat - TradFi incumbents can replicate',
    ],
    catalysts: [
      { event: 'Treasury product SEC filing', timing: 'Q1 2026', impact: 'high' },
      { event: 'USDY expansion to new chains', timing: 'Ongoing', impact: 'medium' },
      { event: 'Institutional custody partnerships', timing: 'Q2 2026', impact: 'high' },
    ],
    socials: { website: 'https://ondo.finance', x: 'https://x.com/OndoFinance', discord: 'https://discord.gg/ondo', telegram: 'https://telegram.me/ondofinance' },
  },
  {
    id: 't3',
    symbol: 'TAO',
    name: 'Bittensor',
    sector: 'AI Agents',
    comparable: 'The AWS of decentralized AI compute',
    riskScore: 6,
    timeHorizon: '12-24 months',
    priceTarget: '$800-1,200',
    conviction: 'Medium',
    mcap: '$3.8B', fdv: '$3.8B', volume24h: '$62M', chain: 'Bittensor (Substrate)',
    currentPrice: '$580', change24h: -3.2,
    analystNote: 'Bittensor is the highest-conviction AI x Crypto bet, but also the highest-risk. The subnet architecture is genuinely innovative - creating a marketplace for AI model inference. The key question is whether decentralized compute can compete on quality, not just cost. Watch Subnet 32 launch closely.',
    peerComps: [
      { symbol: 'RNDR', mcap: '$4.2B', metric: 'GPU compute' },
      { symbol: 'FET', mcap: '$1.8B', metric: 'AI agents' },
      { symbol: 'AKT', mcap: '$920M', metric: 'Cloud compute' },
    ],
    bullCase: [
      'Decentralized AI compute demand growing exponentially',
      'Subnet model creates composable AI marketplace',
      'Token-incentivized model quality improves with scale',
    ],
    bearCase: [
      'Centralized AI (OpenAI, Google) wins on quality',
      'Token emissions dilute value without proportional utility',
      'Subnet quality uneven - noise vs signal problem',
    ],
    catalysts: [
      { event: 'Subnet 32 (text-to-video) launch', timing: 'Q1 2026', impact: 'high' },
      { event: 'Dynamic TAO emission schedule', timing: 'Feb 2026', impact: 'medium' },
      { event: 'Enterprise subnet partnerships', timing: 'H1 2026', impact: 'high' },
    ],
    socials: { website: 'https://bittensor.com', x: 'https://x.com/opentensor', discord: 'https://discord.gg/bittensor', github: 'https://github.com/opentensor' },
  },
  {
    id: 't4',
    symbol: 'AAVE',
    name: 'Aave',
    sector: 'DeFi',
    comparable: 'The JPMorgan of DeFi - institutional lending protocol',
    riskScore: 2,
    timeHorizon: '6-12 months',
    priceTarget: '$420-500',
    conviction: 'High',
    mcap: '$4.2B', fdv: '$4.2B', volume24h: '$210M', tvl: '$12.1B', chain: 'Multi-chain',
    currentPrice: '$280', change24h: 2.8,
    analystNote: 'Aave is the closest thing to a "sure bet" in DeFi. $12B TVL across 12 chains with zero major exploits. The fee switch vote is the most anticipated governance event of 2026 - unlocking ~$50M annually in protocol revenue to token holders transforms AAVE from a governance token to a productive asset.',
    peerComps: [
      { symbol: 'COMP', mcap: '$680M', metric: 'TVL $2.8B' },
      { symbol: 'MORPHO', mcap: '$320M', metric: 'TVL $1.8B' },
      { symbol: 'MKR', mcap: '$2.4B', metric: 'TVL $8.2B' },
    ],
    bullCase: [
      '$12B TVL with proven security track record',
      'Fee switch vote unlocks $50M+ annual revenue to token',
      'GHO stablecoin scales - net interest margin play',
    ],
    bearCase: [
      'Smart contract risk remains non-zero',
      'Fee switch priced in - sell the news risk',
      'CeFi competition (Coinbase, Binance) for yield',
    ],
    catalysts: [
      { event: 'Fee switch governance vote', timing: 'Feb 2026', impact: 'high' },
      { event: 'GHO $1B supply milestone', timing: 'Q1 2026', impact: 'medium' },
      { event: 'Aave v4 architecture upgrade', timing: 'Q2 2026', impact: 'high' },
    ],
    socials: { website: 'https://aave.com', x: 'https://x.com/aabortel', discord: 'https://discord.gg/aave', github: 'https://github.com/aave' },
  },
]

/* Conviction color map */
const CONVICTION_COLOR = {
  high: '#10B981',
  medium: '#FBBF24',
  low: 'rgba(255,255,255,0.3)',
}

/* ════════════════════════════════════════════════════════════════════════════
   DATA-DERIVED THESIS BUILDER
   Pure helpers that turn one live Research Desk project into a THESES-schema
   object using ONLY its real on-chain data — factual, no fabricated specifics.
   ════════════════════════════════════════════════════════════════════════════ */

function num(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/* Codex/DexScreener change values are dual-format: |v|<100 -> ratio, else
   already a percent. Normalize to a real percent. (Mirrors the server's toPct.) */
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

function fmtPrice(n) {
  const v = num(n)
  if (v == null) return null
  const abs = Math.abs(v)
  if (abs >= 1) return `$${v.toFixed(2)}`
  if (abs >= 0.01) return `$${v.toFixed(4)}`
  if (abs >= 0.0001) return `$${v.toFixed(6)}`
  return `$${v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')}`
}

function normSym(symbol) {
  return String(symbol || '').replace(/^\$/, '').toUpperCase()
}

/* riskGrade letter -> a small numeric nudge so the pip bar reflects the grade. */
const GRADE_NUDGE = { A: -2, B: -1, C: 0, D: 1, E: 2, F: 2 }

/* Map compositeScore (0-100, higher = better) + riskGrade into a 1-8 risk pip
   score (1 = safest). Falls back to the project's own riskScore when present. */
function deriveRiskScore(project) {
  const direct = num(project?.riskScore)
  if (direct != null) return Math.max(1, Math.min(8, Math.round(direct)))
  const comp = num(project?.compositeScore)
  // base: a 90+ composite -> ~2, a 30 composite -> ~7
  let base = comp != null ? 8 - (comp / 100) * 6 : 5
  const grade = String(project?.riskGrade || '').trim().charAt(0).toUpperCase()
  if (grade && GRADE_NUDGE[grade] != null) base += GRADE_NUDGE[grade]
  return Math.max(1, Math.min(8, Math.round(base)))
}

/* compositeScore -> conviction bucket. Emerging DeFi is rarely "blue-chip High",
   so the thresholds stay conservative. */
function deriveConviction(project) {
  const comp = num(project?.compositeScore)
  if (comp == null) return 'Medium'
  if (comp >= 75) return 'High'
  if (comp >= 50) return 'Medium'
  return 'Low'
}

/* A factual comparable from sector + category — no fabricated brand analogies. */
function deriveComparable(k) {
  if (k.category && k.sector && k.category.toLowerCase() !== k.sector.toLowerCase()) {
    return `${k.category} protocol in the ${k.sector} sector`
  }
  if (k.category) return `${k.category} protocol`
  if (k.sector) return `${k.sector} protocol${k.chain ? ` on ${k.chain}` : ''}`
  return `Emerging DeFi protocol${k.chain ? ` on ${k.chain}` : ''}`
}

/* A conservative, DATA-DERIVED price-target band. We never invent a number:
   if there's no current price we return '-'. Otherwise a modest band around the
   live price, widened slightly for higher-risk names. No promise of a moon. */
function derivePriceTarget(k, riskScore) {
  if (k.price == null) return '-'
  // wider band for riskier (higher riskScore) names: ~±20% at risk 1 up to ~±55% at risk 8
  const spread = 0.15 + (riskScore / 8) * 0.4
  const lo = k.price * (1 - spread * 0.5)
  const hi = k.price * (1 + spread)
  const loS = fmtPrice(lo)
  const hiS = fmtPrice(hi)
  return loS && hiS ? `${loS}-${hiS.replace(/^\$/, '')}` : '-'
}

/* Factual one-liner analyst note built from the real metrics. */
function deriveAnalystNote(k) {
  const parts = []
  parts.push(`${k.category || k.sector || 'DeFi'} protocol${k.chain ? ` on ${k.chain}` : ''}`)
  if (k.tvl != null) {
    const tvlStr = fmtCompactUsd(k.tvl)
    if (k.change7d != null) {
      const sign = k.change7d >= 0 ? '+' : ''
      parts.push(`TVL ${tvlStr} (${sign}${k.change7d.toFixed(1)}% 7d)`)
    } else {
      parts.push(`TVL ${tvlStr}`)
    }
  }
  if (k.volume24h != null) parts.push(`${fmtCompactUsd(k.volume24h)} 24h volume`)
  if (k.riskGrade) parts.push(`pipeline grade ${k.riskGrade}`)
  if (k.ageDays != null) parts.push(`${k.ageDays}d old`)
  return parts.length ? `${parts.join(', ')}.` : ''
}

/* DATA-DERIVED bull bullets from real signals (TVL growth, liquidity depth,
   audits, momentum). Always factual; capped at 3. */
function deriveBullCase(k) {
  const out = []
  if (k.change7d != null && k.change7d > 0) out.push(`TVL up ${k.change7d.toFixed(1)}% over 7 days`)
  if (k.tvl != null && k.tvl >= 1e6) out.push(`Deep TVL at ${fmtCompactUsd(k.tvl)}`)
  if (k.liquidity != null && k.liquidity >= 1e5) out.push(`Liquidity depth of ${fmtCompactUsd(k.liquidity)}`)
  if (k.audits > 0) out.push(`${k.audits} security ${k.audits === 1 ? 'audit' : 'audits'} on record`)
  if (k.change24h != null && k.change24h > 5) out.push(`Strong 24h momentum (+${k.change24h.toFixed(1)}%)`)
  if (k.revenue24h != null && k.revenue24h > 0) out.push(`Generating ${fmtCompactUsd(k.revenue24h)}/day in fees`)
  if (out.length === 0 && k.sector) out.push(`Positioned in the ${k.sector} sector`)
  return out.slice(0, 3)
}

/* DATA-DERIVED bear bullets — honest risks from the same real signals. Cap 3. */
function deriveBearCase(k) {
  const out = []
  if (k.change7d != null && k.change7d < 0) out.push(`TVL down ${Math.abs(k.change7d).toFixed(1)}% over 7 days`)
  if (k.tvl != null && k.tvl < 1e6) out.push(`Thin TVL (${fmtCompactUsd(k.tvl)}) - low liquidity risk`)
  if (k.liquidity != null && k.liquidity < 1e5) out.push(`Shallow liquidity (${fmtCompactUsd(k.liquidity)})`)
  if (!k.audits) out.push('No audits on record - unverified contracts')
  if (k.ageDays != null && k.ageDays < 90) out.push(`Young protocol (${k.ageDays}d) - limited track record`)
  if (k.change24h != null && k.change24h < -5) out.push(`Weak 24h price action (${k.change24h.toFixed(1)}%)`)
  if (out.length === 0) out.push('Smart-contract and market risk remain non-zero')
  return out.slice(0, 3)
}

/* DATA-DERIVED catalysts from listing date + audit status. Factual only. */
function deriveCatalysts(k, project) {
  const out = []
  const listedAt = project?.listedAt
  if (listedAt) {
    const d = new Date(listedAt)
    if (!isNaN(d.getTime())) {
      out.push({ event: `Listed ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`, timing: 'Live', impact: 'medium' })
    }
  }
  if (k.audits > 0) {
    out.push({ event: `${k.audits} security ${k.audits === 1 ? 'audit' : 'audits'} completed`, timing: 'Ongoing', impact: 'medium' })
  } else {
    out.push({ event: 'Pending security audit', timing: 'TBD', impact: 'high' })
  }
  if (k.tvl != null) {
    out.push({ event: 'TVL growth trajectory', timing: 'Ongoing', impact: 'high' })
  }
  return out.slice(0, 3)
}

/* Peer comps: other same-sector projects from the live set. Cap 3. */
function derivePeerComps(k, project, allProjects) {
  if (!Array.isArray(allProjects)) return []
  const sector = k.sector
  const selfSym = k.symbol
  return allProjects
    .filter(p => p && normSym(p.symbol) !== selfSym && (p.sector || '') === sector)
    .slice(0, 3)
    .map(p => {
      const tvl = fmtCompactUsd(num(p.tvl))
      const mcap = fmtCompactUsd(num(p.mcap))
      return {
        symbol: normSym(p.symbol),
        mcap: mcap || '-',
        metric: tvl ? `TVL ${tvl}` : (p.category || p.sector || ''),
      }
    })
    .filter(p => p.symbol)
}

/* Socials straight off the project (never fabricated). */
function deriveSocials(project) {
  const out = {}
  const s = project?.socials || {}
  if (s.website || project?.url) out.website = s.website || project.url
  if (s.x) out.x = s.x
  else if (project?.twitter) out.x = `https://x.com/${String(project.twitter).replace(/^@/, '')}`
  if (s.discord) out.discord = s.discord
  if (s.telegram) out.telegram = s.telegram
  if (s.github) out.github = s.github
  return out
}

/* Rough time-horizon from age: younger -> longer horizon to maturity. */
function deriveTimeHorizon(k) {
  if (k.ageDays == null) return '6-12 months'
  if (k.ageDays < 90) return '12-24 months'
  if (k.ageDays < 365) return '6-18 months'
  return '6-12 months'
}

/**
 * PURE: build a THESES-schema object from one live project, using only its real
 * data. No fabricated specifics — comparables/conviction/risk/note are derived
 * from sector/category/compositeScore/riskGrade and the on-chain metrics.
 */
function mapProjectToThesis(project, allProjects) {
  const symbol = normSym(project?.symbol)
  const k = {
    symbol,
    name: project?.name || symbol || 'Unknown',
    sector: project?.sector || 'DeFi',
    category: project?.category || null,
    chain: project?.chain || null,
    mcap: num(project?.mcap),
    fdv: num(project?.fdv),
    tvl: num(project?.tvl),
    volume24h: num(project?.volume24h),
    liquidity: num(project?.liquidity),
    price: num(project?.priceUsd),
    change24h: toPct(project?.change24h),
    change7d: project?.tvlChange7d != null ? num(project.tvlChange7d) : (project?.change7d != null ? num(project.change7d) : null),
    revenue24h: project?.revenue24h != null ? num(project.revenue24h) : null,
    audits: num(project?.audits) || 0,
    ageDays: project?.ageDays != null ? num(project.ageDays) : null,
    riskGrade: project?.riskGrade || null,
  }

  const riskScore = deriveRiskScore(project)

  return {
    id: `t-${String(project?.id || project?.address || symbol || 'x').toLowerCase()}`,
    symbol: symbol || '?',
    name: k.name,
    sector: k.sector,
    comparable: deriveComparable(k),
    riskScore,
    timeHorizon: deriveTimeHorizon(k),
    priceTarget: derivePriceTarget(k, riskScore),
    conviction: deriveConviction(project),
    mcap: fmtCompactUsd(k.mcap) || '-',
    fdv: fmtCompactUsd(k.fdv) || undefined,
    volume24h: fmtCompactUsd(k.volume24h) || undefined,
    tvl: fmtCompactUsd(k.tvl) || undefined,
    chain: k.chain || undefined,
    currentPrice: fmtPrice(k.price) || '-',
    change24h: k.change24h != null ? Math.round(k.change24h * 10) / 10 : null,
    analystNote: deriveAnalystNote(k),
    peerComps: derivePeerComps(k, project, allProjects),
    bullCase: deriveBullCase(k),
    bearCase: deriveBearCase(k),
    catalysts: deriveCatalysts(k, project),
    socials: deriveSocials(project),
    _compositeScore: num(project?.compositeScore) ?? -Infinity, // sort key only
  }
}

/**
 * Merge the AI-enriched thesis OVER the data-derived one. AI wins for the prose
 * fields; the ground-truth NUMBERS (mcap/fdv/volume/tvl/chain/price/change24h/
 * identity) always come from the data-derived (project) object. Defensive: only
 * adopt AI fields that are actually present + well-formed.
 */
function mergeAiThesis(base, ai) {
  if (!ai || typeof ai !== 'object') return base
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0
  const isArr = (v) => Array.isArray(v) && v.length > 0
  return {
    ...base,
    // prose fields — AI wins when present
    comparable: isStr(ai.comparable) ? ai.comparable.trim() : base.comparable,
    conviction: ['High', 'Medium', 'Low'].includes(ai.conviction) ? ai.conviction : base.conviction,
    riskScore: Number.isFinite(num(ai.riskScore)) ? Math.max(1, Math.min(8, Math.round(num(ai.riskScore)))) : base.riskScore,
    timeHorizon: isStr(ai.timeHorizon) ? ai.timeHorizon.trim() : base.timeHorizon,
    priceTarget: isStr(ai.priceTarget) ? ai.priceTarget.trim() : base.priceTarget,
    analystNote: isStr(ai.analystNote) ? ai.analystNote.trim() : base.analystNote,
    bullCase: isArr(ai.bullCase) ? ai.bullCase.filter(x => typeof x === 'string' && x.trim()).slice(0, 3) : base.bullCase,
    bearCase: isArr(ai.bearCase) ? ai.bearCase.filter(x => typeof x === 'string' && x.trim()).slice(0, 3) : base.bearCase,
    catalysts: isArr(ai.catalysts) ? ai.catalysts.filter(c => c && typeof c.event === 'string' && c.event.trim()).slice(0, 3) : base.catalysts,
    peerComps: isArr(ai.peerComps) ? ai.peerComps.filter(p => p && typeof p.symbol === 'string' && p.symbol.trim()).slice(0, 3) : base.peerComps,
    // identity + NUMBERS always from the project (ground-truth) — keep base.*
  }
}

function AlphaThesisCards({ activeSymbol, projects, aiTheses }) {
  const [expandedCard, setExpandedCard] = useState(null)
  const [visibleCards, setVisibleCards] = useState(new Set())
  const [modalThesis, setModalThesis] = useState(null)
  const cardRefs = useRef({})

  /* ── Build the live thesis list ───────────────────────────────────────────
     projects.map(mapProjectToThesis) -> merge AI prose over each symbol present
     in `aiTheses` -> sort by compositeScore (desc). When `projects` is empty
     (dev cold start / failed bundle), fall back to the static set so the tab
     never renders blank. */
  const theses = useMemo(() => {
    const list = Array.isArray(projects) ? projects.filter(Boolean) : []
    if (list.length === 0) return STATIC_THESES

    const ai = aiTheses && typeof aiTheses === 'object' ? aiTheses : {}
    const built = list.map((p) => {
      const base = mapProjectToThesis(p, list)
      const enriched = ai[base.symbol]
      return enriched ? mergeAiThesis(base, enriched) : base
    })

    // Sort by compositeScore (desc); ties keep input order via the index map.
    return built
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const sa = Number.isFinite(a.t._compositeScore) ? a.t._compositeScore : -Infinity
        const sb = Number.isFinite(b.t._compositeScore) ? b.t._compositeScore : -Infinity
        if (sb !== sa) return sb - sa
        return a.i - b.i
      })
      .map(({ t }) => t)
  }, [projects, aiTheses])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setVisibleCards(prev => new Set([...prev, entry.target.dataset.id]))
          }
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )
    Object.values(cardRefs.current).forEach(el => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [theses])

  /* Escape key + body scroll lock for modal */
  useEffect(() => {
    if (!modalThesis) return
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setModalThesis(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [modalThesis])

  const riskLabel = (score) => {
    if (score <= 2) return 'Low'
    if (score <= 4) return 'Moderate'
    if (score <= 6) return 'Elevated'
    return 'High'
  }

  const riskColor = (score) => {
    if (score <= 2) return '#10B981'
    if (score <= 4) return '#FBBF24'
    if (score <= 6) return '#F97316'
    return '#EF4444'
  }

  return (
    <div className="atc">
      {/* Thesis grid */}
      <div className="atc-grid">
        {theses.map((thesis, i) => {
          const logo = getTokenLogo(thesis.symbol)
          const isExpanded = expandedCard === thesis.id
          const isVisible = visibleCards.has(thesis.id)
          const rColor = riskColor(thesis.riskScore)
          const conviction = thesis.conviction || 'Medium'
          const convColor = CONVICTION_COLOR[conviction.toLowerCase()] || CONVICTION_COLOR.low

          return (
            <div
              key={thesis.id}
              className={`atc-card ${isExpanded ? 'is-expanded' : ''} ${isVisible ? 'is-visible' : ''} ${activeSymbol && thesis.symbol === activeSymbol ? 'is-highlighted' : ''} ${activeSymbol && thesis.symbol !== activeSymbol ? 'is-dimmed' : ''}`}
              data-id={thesis.id}
              ref={el => cardRefs.current[thesis.id] = el}
              style={{ transitionDelay: `${i * 60}ms` }}
              onClick={() => setModalThesis(thesis)}
            >
              {/* Conviction-colored accent edge */}
              <div
                className="atc-card-accent"
                style={{ background: `linear-gradient(90deg, transparent, ${convColor}40, transparent)` }}
              />

              {/* Header */}
              <div className="atc-card-head">
                <div className="atc-card-token">
                  {logo ? (
                    <img className="atc-card-logo" src={logo} alt={thesis.symbol} />
                  ) : (
                    <div className="atc-card-logo atc-card-logo--fallback">
                      {(thesis.symbol || '?').charAt(0)}
                    </div>
                  )}
                  <div className="atc-card-names">
                    <span className="atc-card-symbol">{thesis.symbol}</span>
                    <span className="atc-card-name">{thesis.name}</span>
                  </div>
                </div>
                <div className="atc-card-conviction" data-level={conviction.toLowerCase()}>
                  {conviction}<InfoTip text="Analyst confidence level in the thesis - High, Medium, or Low." position="left" />
                </div>
              </div>

              {/* Comparable */}
              <p className="atc-card-comparable">{thesis.comparable}</p>

              {/* Quick metrics */}
              <div className="atc-card-quick">
                <div className="atc-card-quick-item">
                  <span className="atc-card-quick-label">Risk<InfoTip text="Risk score from 1 (safest) to 8 (most risky) based on liquidity, volatility, and concentration." position="top" /></span>
                  <div className="atc-card-risk-bar">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                      <span
                        key={n}
                        className={`atc-risk-pip ${n <= thesis.riskScore ? 'is-filled' : ''}`}
                        style={{
                          background: n <= thesis.riskScore ? rColor : undefined,
                          boxShadow: n <= thesis.riskScore ? `0 0 4px ${rColor}30` : 'none',
                        }}
                      />
                    ))}
                  </div>
                  <span className="atc-card-risk-label" style={{ color: rColor }}>
                    {riskLabel(thesis.riskScore)}
                  </span>
                </div>
                <div className="atc-card-quick-item">
                  <span className="atc-card-quick-label">Target<InfoTip text="Analyst price target - the expected price if the bull case thesis plays out." position="top" /></span>
                  <span className="atc-card-quick-value">{thesis.priceTarget}</span>
                </div>
                <div className="atc-card-quick-item">
                  <span className="atc-card-quick-label">Horizon<InfoTip text="Expected timeframe for the thesis to play out." position="top" /></span>
                  <span className="atc-card-quick-value">{thesis.timeHorizon}</span>
                </div>
              </div>

              {/* Bull / Bear cases */}
              <div className="atc-card-cases">
                <div className="atc-card-case atc-card-case--bull">
                  <span className="atc-card-case-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
                    Bull Case<InfoTip text="Best-case scenario - reasons the price could increase significantly." position="right" />
                  </span>
                  <ul className="atc-card-case-list">
                    {(thesis.bullCase || []).map((point, j) => (
                      <li key={j}>{point}</li>
                    ))}
                  </ul>
                </div>
                <div className="atc-card-case atc-card-case--bear">
                  <span className="atc-card-case-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7l9.2 9.2M7 7h10v10" /></svg>
                    Bear Case<InfoTip text="Worst-case scenario - risks that could cause the price to decline." position="right" />
                  </span>
                  <ul className="atc-card-case-list">
                    {(thesis.bearCase || []).map((point, j) => (
                      <li key={j}>{point}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Catalysts timeline */}
              <div className="atc-card-catalysts">
                <span className="atc-card-catalysts-label">Key Catalysts<InfoTip text="Specific upcoming events that could trigger significant price movement." position="right" /></span>
                <div className="atc-card-catalysts-list">
                  {(thesis.catalysts || []).map((cat, j) => (
                    <div key={j} className="atc-catalyst">
                      <span
                        className={`atc-catalyst-impact atc-catalyst-impact--${cat.impact}`}
                        style={{
                          boxShadow: cat.impact === 'high'
                            ? '0 0 6px rgba(16,185,129,0.3)'
                            : cat.impact === 'medium'
                            ? '0 0 6px rgba(251,191,36,0.3)'
                            : 'none',
                        }}
                      />
                      <div className="atc-catalyst-info">
                        <span className="atc-catalyst-event">{cat.event}</span>
                        <span className="atc-catalyst-timing">{cat.timing}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="atc-card-footer">
                <span className="atc-card-sector">{thesis.sector}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Expanded thesis modal - portaled to body ── */}
      {modalThesis && createPortal(
        (() => {
          const t = modalThesis
          const logo = getTokenLogo(t.symbol)
          const rColor = riskColor(t.riskScore)
          const tConviction = t.conviction || 'Medium'
          const convColor = CONVICTION_COLOR[tConviction.toLowerCase()] || CONVICTION_COLOR.low

          return (
            <div className="atc-overlay" onClick={() => setModalThesis(null)}>
              <div className="atc-modal" onClick={e => e.stopPropagation()}>
                {/* Ambient conviction glow */}
                <div className="atc-modal-glow" style={{ '--conv-color': convColor }} aria-hidden="true" />
                {/* Top accent edge */}
                <div className="atc-modal-accent" style={{ background: `linear-gradient(90deg, transparent, ${convColor}55, transparent)` }} aria-hidden="true" />

                {/* Row 1: Identity + conviction + close - stagger 0 */}
                <div className="atc-modal-top atc-modal-stagger" style={{ '--stagger': 0 }}>
                  <div className="atc-modal-token">
                    <div className="atc-modal-logo-wrap">
                      {logo ? (
                        <img className="atc-modal-logo" src={logo} alt={t.symbol} />
                      ) : (
                        <div className="atc-modal-logo atc-modal-logo--fallback">{(t.symbol || '?').charAt(0)}</div>
                      )}
                    </div>
                    <div className="atc-modal-names">
                      <div className="atc-modal-names-row">
                        <span className="atc-modal-symbol">{t.symbol}</span>
                        <span className="atc-modal-price">{t.currentPrice}</span>
                        {t.change24h != null && (
                          <span className={`atc-modal-change ${t.change24h >= 0 ? 'is-bull' : 'is-bear'}`}>
                            {t.change24h >= 0 ? '+' : ''}{t.change24h}%
                          </span>
                        )}
                      </div>
                      <span className="atc-modal-name">{t.name}</span>
                    </div>
                  </div>
                  <div className="atc-modal-top-right">
                    <div className="atc-modal-conv-badge" data-level={tConviction.toLowerCase()}>
                      {tConviction} Conviction
                    </div>
                    <button className="atc-modal-close" onClick={() => setModalThesis(null)} aria-label="Close">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Comparable - stagger 1 */}
                {t.comparable && (
                  <p className="atc-modal-comparable atc-modal-stagger" style={{ '--stagger': 1 }}>"{t.comparable}"</p>
                )}

                {/* Metrics grid - stagger 2 */}
                <div className="atc-modal-metrics atc-modal-stagger" style={{ '--stagger': 2 }}>
                  <div className="atc-modal-metric">
                    <span className="atc-modal-metric-label">Market Cap</span>
                    <span className="atc-modal-metric-value">{t.mcap}</span>
                  </div>
                  {t.fdv && (
                    <div className="atc-modal-metric">
                      <span className="atc-modal-metric-label">FDV</span>
                      <span className="atc-modal-metric-value">{t.fdv}</span>
                    </div>
                  )}
                  {t.volume24h && (
                    <div className="atc-modal-metric">
                      <span className="atc-modal-metric-label">Vol 24h</span>
                      <span className="atc-modal-metric-value">{t.volume24h}</span>
                    </div>
                  )}
                  {t.tvl && (
                    <div className="atc-modal-metric">
                      <span className="atc-modal-metric-label">TVL</span>
                      <span className="atc-modal-metric-value">{t.tvl}</span>
                    </div>
                  )}
                  <div className="atc-modal-metric">
                    <span className="atc-modal-metric-label">Target</span>
                    <span className="atc-modal-metric-value">{t.priceTarget}</span>
                  </div>
                  <div className="atc-modal-metric">
                    <span className="atc-modal-metric-label">Horizon</span>
                    <span className="atc-modal-metric-value">{t.timeHorizon}</span>
                  </div>
                  <div className="atc-modal-metric">
                    <span className="atc-modal-metric-label">Risk</span>
                    <span className="atc-modal-metric-value" style={{ color: rColor }}>{riskLabel(t.riskScore)} ({t.riskScore}/8)</span>
                  </div>
                </div>

                {/* Two-column: Bull + Bear - stagger 3 */}
                <div className="atc-modal-row atc-modal-stagger" style={{ '--stagger': 3 }}>
                  <div className="atc-modal-case atc-modal-case--bull">
                    <span className="atc-modal-case-label">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
                      Bull Case
                    </span>
                    <ul className="atc-modal-case-list">
                      {(t.bullCase || []).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                  <div className="atc-modal-case atc-modal-case--bear">
                    <span className="atc-modal-case-label">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7l9.2 9.2M7 7h10v10" /></svg>
                      Bear Case
                    </span>
                    <ul className="atc-modal-case-list">
                      {(t.bearCase || []).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                </div>

                {/* Two-column: Catalysts + Peer Comps - stagger 4 */}
                <div className="atc-modal-row atc-modal-stagger" style={{ '--stagger': 4 }}>
                  {/* Catalysts */}
                  <div className="atc-modal-section">
                    <span className="atc-modal-section-label">Key Catalysts</span>
                    <div className="atc-modal-catalysts">
                      {(t.catalysts || []).map((cat, j) => (
                        <div key={j} className="atc-modal-catalyst">
                          <span className={`atc-modal-catalyst-dot atc-modal-catalyst-dot--${cat.impact}`} />
                          <span className="atc-modal-catalyst-event">{cat.event}</span>
                          <span className="atc-modal-catalyst-timing">{cat.timing}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Peer comparisons */}
                  {t.peerComps?.length > 0 && (
                    <div className="atc-modal-section">
                      <span className="atc-modal-section-label">Peer Comparison</span>
                      <div className="atc-modal-peers">
                        {t.peerComps.map((peer, j) => (
                          <div key={j} className="atc-modal-peer">
                            <span className="atc-modal-peer-symbol">{peer.symbol}</span>
                            <span className="atc-modal-peer-mcap">{peer.mcap}</span>
                            <span className="atc-modal-peer-metric">{peer.metric}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Analyst note - stagger 5 */}
                {t.analystNote && (
                  <div className="atc-modal-section atc-modal-stagger" style={{ '--stagger': 5 }}>
                    <span className="atc-modal-section-label">Analyst Note</span>
                    <p className="atc-modal-analyst-note">{t.analystNote}</p>
                  </div>
                )}

                {/* Footer: sector + chain + socials - stagger 6 */}
                <div className="atc-modal-divider" aria-hidden="true" />
                <div className="atc-modal-footer atc-modal-stagger" style={{ '--stagger': 6 }}>
                  <div className="atc-modal-footer-left">
                    <span className="atc-modal-sector">{t.sector}</span>
                    {t.chain && (
                      <span className="atc-modal-chain">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                        {t.chain}
                      </span>
                    )}
                  </div>
                  {t.socials && Object.keys(t.socials).length > 0 && (
                    <div className="atc-modal-socials">
                      {Object.entries(t.socials).map(([key, url]) => {
                        const icon = SOCIAL_ICONS[key]
                        if (!icon) return null
                        return (
                          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="atc-modal-social-link" title={key.charAt(0).toUpperCase() + key.slice(1)} onClick={e => e.stopPropagation()}>
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

export default AlphaThesisCards
