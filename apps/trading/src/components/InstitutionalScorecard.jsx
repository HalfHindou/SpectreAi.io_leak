/**
 * InstitutionalScorecard - "The Rating Desk"
 * Morningstar/S&P meets DeFi fundamentals.
 * Letter grades across institutional dimensions:
 *   Liquidity · Concentration · Revenue · Smart Money · Momentum
 *
 * Glass card design with SVG arc gauges for overall grade,
 * animated bar fills, and cinematic blur-in entrance.
 */
import React, { useRef, useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getTokenLogo } from '../data/alphaFeedData'
import { formatMcap, formatVolume } from '../hooks/useResearchDeskPrices'
import InfoTip from './InfoTip'
import './InstitutionalScorecard.css'

const DIM_TIPS = {
  'Liquidity': 'How easily the token can be bought or sold without moving the price.',
  'Concentration': 'How spread out ownership is. Low concentration means healthier distribution.',
  'Revenue': 'Protocol fee generation - real yield from actual usage, not just token emissions.',
  'Smart Money': 'Institutional and whale wallet accumulation patterns.',
  'Momentum': 'Price trend strength based on technical indicators and volume confirmation.',
}

/* ── Grade dimensions ── */
const DIMENSIONS = [
  { id: 'liquidity', label: 'Liquidity', desc: 'Depth & spread' },
  { id: 'concentration', label: 'Concentration', desc: 'Holder dist.' },
  { id: 'revenue', label: 'Revenue', desc: 'Fee generation' },
  { id: 'smartMoney', label: 'Smart Money', desc: 'Inst. flow' },
  { id: 'momentum', label: 'Momentum', desc: 'Price action' },
]

/* ── Grade colors ── */
const GRADE_COLOR = {
  'A+': '#10B981', 'A': '#10B981', 'A-': '#10B981',
  'B+': '#34D399', 'B': '#FBBF24', 'B-': '#FBBF24',
  'C+': '#F59E0B', 'C': '#F97316', 'C-': '#F97316',
  'D': '#EF4444', 'F': '#EF4444',
}

/* Numeric score 0-100 for bar width + arc fill */
const GRADE_SCORE = {
  'A+': 98, 'A': 92, 'A-': 87,
  'B+': 82, 'B': 75, 'B-': 68,
  'C+': 62, 'C': 55, 'C-': 48,
  'D': 35, 'F': 15,
}

/* ── Mock scorecard data ── */
const SCORECARDS = [
  {
    symbol: 'ETH', name: 'Ethereum',
    overall: 'A+', sector: 'Infrastructure', mcap: '$380B',
    grades: { liquidity: 'A+', concentration: 'A', revenue: 'A', smartMoney: 'A+', momentum: 'B+' },
    insight: 'Institutional benchmark asset. Deflationary supply dynamics and ETF inflows drive sustained demand.',
    extended: {
      prevGrade: 'A+',
      metrics: { tvl: '$48.2B', volume24h: '$14.7B', holders: '120.4M', fdv: '$380B' },
      socials: {
        website: 'https://ethereum.org',
        x: 'https://x.com/ethereum',
        discord: 'https://discord.gg/ethereum-org',
        github: 'https://github.com/ethereum',
      },
      dimensionNotes: {
        liquidity: 'Deepest order books across all CEX and DEX venues. <$1M trades execute with <0.01% slippage.',
        concentration: 'Post-merge validator set exceeds 900K. Top 10 wallets hold <8% of circulating supply.',
        revenue: '$2.4B annualized fee revenue. EIP-1559 burn creates persistent deflationary pressure.',
        smartMoney: 'ETF inflows averaging $180M/week. Major institutions adding via Coinbase Prime and Fidelity.',
        momentum: 'Consolidating above $3,200 support. RSI neutral at 52 with volume declining - awaiting catalyst.',
      },
      catalysts: [
        'Pectra upgrade (Q1 2026) - account abstraction and blob scaling',
        'Spot ETF staking approval could unlock 4-5% yield for TradFi',
        'L2 fee revenue sharing proposals gaining governance traction',
      ],
      risks: [
        'L2 fragmentation diluting base layer value capture',
        'Regulatory classification uncertainty in EU markets',
        'Competitor chains capturing incremental DeFi TVL share',
      ],
    },
  },
  {
    symbol: 'SOL', name: 'Solana',
    overall: 'A', sector: 'Infrastructure', mcap: '$78B',
    grades: { liquidity: 'A', concentration: 'B+', revenue: 'A-', smartMoney: 'A', momentum: 'A' },
    insight: 'Consumer chain leader. Firedancer client and payments narrative strengthening institutional thesis.',
    extended: {
      prevGrade: 'A-',
      metrics: { tvl: '$8.1B', volume24h: '$4.2B', holders: '28.6M', fdv: '$95B' },
      socials: {
        website: 'https://solana.com',
        x: 'https://x.com/solana',
        discord: 'https://discord.gg/solana',
        github: 'https://github.com/solana-labs',
        telegram: 'https://telegram.me/solana',
      },
      dimensionNotes: {
        liquidity: 'Jupiter aggregates $2B+ daily volume. CEX order book depth rivals ETH on major pairs.',
        concentration: 'Validator count at 1,800+. Foundation stake declining but early investor unlocks ongoing.',
        revenue: '$890M annualized protocol fees. Priority fees and MEV revenue growing 40% QoQ.',
        smartMoney: 'Multicoin, a16z, and Pantera increasing positions. Spot ETF filing catalyzing new inflows.',
        momentum: 'Strong uptrend - 30D performance +22%. Breaking above $180 resistance with volume confirmation.',
      },
      catalysts: [
        'Firedancer client launch - second validator client improves resilience',
        'Spot ETF filing by VanEck and 21Shares under SEC review',
        'Visa and Shopify payment integrations expanding merchant access',
      ],
      risks: [
        'Network outage history raises institutional reliability concerns',
        'High FDV relative to circulating supply from ongoing unlocks',
        'Memecoin activity inflating on-chain metrics artificially',
      ],
    },
  },
  {
    symbol: 'AAVE', name: 'Aave',
    overall: 'A-', sector: 'DeFi', mcap: '$4.2B',
    grades: { liquidity: 'A-', concentration: 'B+', revenue: 'A', smartMoney: 'A-', momentum: 'B+' },
    insight: 'DeFi blue chip with $12B TVL. Fee switch catalyst could re-rate the token significantly.',
    extended: {
      prevGrade: 'B+',
      metrics: { tvl: '$12.3B', volume24h: '$420M', holders: '148K', fdv: '$4.8B' },
      socials: {
        website: 'https://aave.com',
        x: 'https://x.com/aaborrowx',
        discord: 'https://discord.gg/aave',
        github: 'https://github.com/aave',
      },
      dimensionNotes: {
        liquidity: 'Top 3 DEX liquidity across Ethereum, Arbitrum, and Polygon. Institutional OTC desks active.',
        concentration: 'DAO treasury holds 16% of supply. Top 10 non-contract wallets hold ~22%.',
        revenue: '$180M annualized revenue from lending spreads. GHO stablecoin adding incremental yield.',
        smartMoney: 'DeFi-native funds (Paradigm, Variant) accumulating. On-chain whale wallets up 12% in 90 days.',
        momentum: 'Bounced off $92 support. Fee switch governance proposal driving renewed accumulation.',
      },
      catalysts: [
        'Fee switch activation - redirecting protocol revenue to AAVE stakers',
        'GHO stablecoin crossing $500M supply - expanding protocol moat',
        'Aave v4 with unified liquidity layer across all chains',
      ],
      risks: [
        'Smart contract risk across 10+ deployments',
        'Regulatory pressure on DeFi lending protocols',
        'Competition from Morpho, Spark, and Kamino eroding market share',
      ],
    },
  },
  {
    symbol: 'ONDO', name: 'Ondo Finance',
    overall: 'B+', sector: 'RWA', mcap: '$2.1B',
    grades: { liquidity: 'B+', concentration: 'B', revenue: 'B+', smartMoney: 'A', momentum: 'A-' },
    insight: 'Leading RWA tokenization play. BlackRock partnership and treasury product filing are key catalysts.',
    extended: {
      prevGrade: 'B',
      metrics: { tvl: '$620M', volume24h: '$185M', holders: '42K', fdv: '$6.8B' },
      socials: {
        website: 'https://ondo.finance',
        x: 'https://x.com/OndoFinance',
        discord: 'https://discord.gg/ondo',
        telegram: 'https://telegram.me/OndoFinance',
      },
      dimensionNotes: {
        liquidity: 'Growing CEX listings but DEX depth still thin. Spread widens on $500K+ trades.',
        concentration: 'Team and investor tokens represent ~65% of FDV. Vesting schedule extends through 2027.',
        revenue: 'OUSG and USDY generating $28M annualized from treasury yield management fees.',
        smartMoney: 'BlackRock BUIDL integration. Pantera and Founders Fund early backers holding strong.',
        momentum: 'Breakout from $1.20 range with +35% in 14 days. Volume spike confirms institutional interest.',
      },
      catalysts: [
        'BlackRock BUIDL fund expansion to Solana and Arbitrum via Ondo',
        'SEC tokenized securities framework could legitimize RWA sector',
        'Short-term treasury product targeting money market fund displacement',
      ],
      risks: [
        'High FDV/MCap ratio - significant dilution from upcoming unlocks',
        'Regulatory moat depends on evolving SEC stance on tokenized securities',
        'Revenue tied to interest rate environment - rate cuts reduce treasury yields',
      ],
    },
  },
  {
    symbol: 'LINK', name: 'Chainlink',
    overall: 'A', sector: 'Infrastructure', mcap: '$12.8B',
    grades: { liquidity: 'A', concentration: 'B+', revenue: 'B+', smartMoney: 'A', momentum: 'B+' },
    insight: 'Oracle monopoly with CCIP positioning it as cross-chain infrastructure. Staking v0.2 imminent.',
    extended: {
      prevGrade: 'A',
      metrics: { tvl: '$18.2B secured', volume24h: '$680M', holders: '720K', fdv: '$13.5B' },
      socials: {
        website: 'https://chain.link',
        x: 'https://x.com/chainlink',
        discord: 'https://discord.gg/chainlink',
        github: 'https://github.com/smartcontractkit',
        telegram: 'https://telegram.me/chainlinkofficial',
      },
      dimensionNotes: {
        liquidity: 'Deep CEX liquidity on all major exchanges. Coinbase and Binance top $200M daily volume.',
        concentration: 'Team wallet holds ~35% but vesting is transparent. Community distribution improving.',
        revenue: 'CCIP message fees growing 60% QoQ. Oracle fees stable at $95M annualized.',
        smartMoney: 'SWIFT PoC driving TradFi interest. Whale accumulation zone identified at $14-16 range.',
        momentum: 'Trading in ascending channel. CCIP adoption metrics providing fundamental price support.',
      },
      catalysts: [
        'Staking v0.2 with slashing - unlocking institutional staking demand',
        'SWIFT cross-chain messaging production deployment',
        'CCIP becoming default bridge for tokenized asset transfers',
      ],
      risks: [
        'Team token concentration and periodic large transfers create sell pressure',
        'API3 and Pyth competing on latency-sensitive oracle feeds',
        'Revenue growth dependent on cross-chain activity which is cyclical',
      ],
    },
  },
  {
    symbol: 'TAO', name: 'Bittensor',
    overall: 'B', sector: 'AI Agents', mcap: '$3.8B',
    grades: { liquidity: 'B', concentration: 'C+', revenue: 'B-', smartMoney: 'B+', momentum: 'B' },
    insight: 'High-beta AI compute marketplace. Subnet expansion shows traction but concentration risk remains.',
    extended: {
      prevGrade: 'B-',
      metrics: { tvl: '$1.2B staked', volume24h: '$210M', holders: '58K', fdv: '$4.5B' },
      socials: {
        website: 'https://bittensor.com',
        x: 'https://x.com/opentensor',
        discord: 'https://discord.gg/bittensor',
        github: 'https://github.com/opentensor',
      },
      dimensionNotes: {
        liquidity: 'Primarily Binance and MEXC. DEX liquidity thin outside of main TAO/USDT pool.',
        concentration: 'Mining rewards heavily concentrated - top 20 miners control ~40% of emissions.',
        revenue: 'Subnet registration fees and compute marketplace generating $12M annualized - early stage.',
        smartMoney: 'Polychain and DCG early backers. AI narrative fund allocations increasing.',
        momentum: 'Range-bound between $350-450. Needs AI narrative catalyst for next leg up.',
      },
      catalysts: [
        'Subnet 32+ launches targeting enterprise AI inference workloads',
        'Dynamic TAO (dTAO) enabling subnet-level token economics',
        'OpenAI and Anthropic partnership rumors for decentralized training',
      ],
      risks: [
        'Mining centralization undermines decentralized AI thesis',
        'Subnet quality highly variable - many inactive or low-value',
        'Token emissions schedule creates persistent sell pressure',
      ],
    },
  },
]

/* ── SVG Arc Gauge for overall grade ── */
function GradeArc({ grade, color, isVisible }) {
  const score = GRADE_SCORE[grade] || 50
  const r = 24
  const c = 2 * Math.PI * r
  const arcPct = 0.75 // 270 deg arc
  const arcLen = c * arcPct
  const offset = arcLen - (score / 100) * arcLen
  return (
    <div className="isc-grade-arc">
      <svg width="56" height="56" viewBox="0 0 56 56">
        {/* Track */}
        <circle
          className="isc-grade-arc-track"
          cx="28" cy="28" r={r}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="3"
          strokeDasharray={`${arcLen} ${c - arcLen}`}
          strokeLinecap="round"
          transform="rotate(135 28 28)"
        />
        {/* Fill */}
        <circle
          cx="28" cy="28" r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${arcLen} ${c - arcLen}`}
          strokeDashoffset={isVisible ? offset : arcLen}
          strokeLinecap="round"
          transform="rotate(135 28 28)"
          className="isc-grade-arc-fill"
          style={{ filter: `drop-shadow(0 0 4px ${color}40)` }}
        />
      </svg>
      <span className="isc-grade-arc-letter" style={{ color }}>
        {grade}
      </span>
    </div>
  )
}

/* ── Metric labels for the detail popup ── */
const METRIC_LABELS = {
  tvl: 'TVL',
  volume24h: '24h Volume',
  holders: 'Holders',
  fdv: 'FDV',
  liquidity: 'Liquidity',
  mcap: 'Market Cap',
  revenue24h: '24h Revenue',
}

/* ── Map a dynamic backend project → the SCORECARD shape ──
   Objective data only. The bundle already provides the 5 grades + an overall
   grade + pre-formatted metric strings. Prose fields (dimensionNotes /
   catalysts / risks) are Phase 2 → left undefined so the detail popup's
   `ext.x &&` guards omit those sections gracefully. `insight` is a short
   factual line derived from the grades + TVL (no invented narrative). */
function mapProjectToScorecard(p) {
  const sc = p.scorecard || {}
  const grades = sc.grades || {}
  const m = sc.metrics || {}
  // Factual one-liner: prefer the bundle's thesis; else compose from grades.
  const insight = p.thesis ||
    `Liquidity ${grades.liquidity || '-'} · Revenue ${grades.revenue || '-'}${m.tvl ? ` · TVL ${m.tvl}` : ''}`
  // Detail-popup metrics: surface the 4 most relevant of the bundle's strings.
  const metrics = {}
  if (m.tvl) metrics.tvl = m.tvl
  if (m.volume24h) metrics.volume24h = m.volume24h
  if (m.liquidity) metrics.liquidity = m.liquidity
  if (m.fdv) metrics.fdv = m.fdv
  return {
    id: p.id || p.address || p.symbol, // stable unique key (two diff projects can share a ticker)
    symbol: p.symbol,
    name: p.name,
    logo: p.logo || null,
    overall: sc.overall || p.riskGrade || 'C',
    sector: p.sector || p.category || 'DeFi',
    mcap: m.mcap || formatMcap(p.mcap) || '',
    grades: {
      liquidity: grades.liquidity || 'C',
      concentration: grades.concentration || 'C',
      revenue: grades.revenue || 'C',
      smartMoney: grades.smartMoney || 'C',
      momentum: grades.momentum || 'C',
    },
    insight,
    extended: {
      // prevGrade omitted (no history feed) → trend pill won't render.
      metrics: Object.keys(metrics).length ? metrics : undefined,
      socials: p.socials && Object.keys(p.socials).length ? p.socials : undefined,
      // dimensionNotes / catalysts / risks intentionally undefined (Phase 2).
    },
  }
}

/* ── Social icon SVG paths (viewBox 0 0 24 24, filled) ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', fill: false, paths: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z'] },
  x: { viewBox: '0 0 24 24', fill: true, paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'] },
  discord: { viewBox: '0 0 24 24', fill: true, paths: ['M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z'] },
  github: { viewBox: '0 0 24 24', fill: true, paths: ['M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z'] },
  telegram: { viewBox: '0 0 24 24', fill: true, paths: ['M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'] },
}

function InstitutionalScorecard({ activeSymbol, livePrices = {}, projects = null }) {
  const [visibleCards, setVisibleCards] = useState(new Set())
  const [selectedCard, setSelectedCard] = useState(null)
  const cardRefs = useRef({})

  /* Dynamic backend projects (preferred) → SCORECARD shape; fall back to the
     static SCORECARDS (with CoinGecko live overlay) for back-compat. */
  const scorecards = useMemo(() => {
    if (Array.isArray(projects) && projects.length > 0) {
      return projects.map(mapProjectToScorecard)
    }
    if (!livePrices || Object.keys(livePrices).length === 0) return SCORECARDS
    return SCORECARDS.map(card => {
      const live = livePrices[card.symbol]
      if (!live) return card
      return {
        ...card,
        mcap: formatMcap(live.mcap) || card.mcap,
        extended: card.extended ? {
          ...card.extended,
          metrics: {
            ...card.extended.metrics,
            volume24h: formatVolume(live.volume24h) || card.extended.metrics.volume24h,
            fdv: formatMcap(live.fdv) || card.extended.metrics.fdv,
          }
        } : card.extended,
      }
    })
  }, [projects, livePrices])

  // Escape key closes detail popup + body scroll lock (compensate scrollbar shift)
  useEffect(() => {
    if (!selectedCard) return
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarW}px`
    const onKey = (e) => { if (e.key === 'Escape') setSelectedCard(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [selectedCard])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setVisibleCards(prev => new Set([...prev, entry.target.dataset.symbol]))
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )
    Object.values(cardRefs.current).forEach(el => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="isc">
      {/* Dimension column headers */}
      <div className="isc-dim-headers">
        <div className="isc-dim-headers-spacer" />
        <div className="isc-dim-headers-row">
          {DIMENSIONS.map(dim => (
            <div key={dim.id} className="isc-dim-header">
              <span className="isc-dim-header-label">{dim.label}<InfoTip text={DIM_TIPS[dim.label]} position="bottom" /></span>
              <span className="isc-dim-header-desc">{dim.desc}</span>
            </div>
          ))}
        </div>
        <div className="isc-dim-headers-spacer-right" />
      </div>

      {/* Scorecard rows */}
      <div className="isc-list">
        {scorecards.map((card, i) => {
          const logo = card.logo || getTokenLogo(card.symbol)
          const overallColor = GRADE_COLOR[card.overall] || '#FBBF24'
          const isVisible = visibleCards.has(card.symbol)

          return (
            <div
              key={card.id || card.symbol}
              className={`isc-row ${isVisible ? 'is-visible' : ''} ${activeSymbol && card.symbol === activeSymbol ? 'is-highlighted' : ''} ${activeSymbol && card.symbol !== activeSymbol ? 'is-dimmed' : ''}`}
              data-symbol={card.symbol}
              ref={el => cardRefs.current[card.symbol] = el}
              style={{ transitionDelay: `${i * 60}ms` }}
              onClick={() => setSelectedCard(card)}
            >
              {/* Top accent edge - color-coded to grade */}
              <div
                className="isc-row-accent"
                style={{ background: `linear-gradient(90deg, transparent, ${overallColor}30, transparent)` }}
              />

              {/* Left: Token + overall grade arc */}
              <div className="isc-row-left">
                <GradeArc grade={card.overall} color={overallColor} isVisible={isVisible} />
                <div className="isc-row-token">
                  {logo ? (
                    <img className="isc-row-logo" src={logo} alt={card.symbol} />
                  ) : (
                    <div className="isc-row-logo isc-row-logo--fallback">
                      {card.symbol.charAt(0)}
                    </div>
                  )}
                  <div className="isc-row-names">
                    <span className="isc-row-symbol">{card.symbol}</span>
                    <span className="isc-row-name">{card.name}</span>
                  </div>
                </div>
                <div className="isc-row-meta">
                  <span className="isc-row-sector">{card.sector}</span>
                  <span className="isc-row-mcap">{card.mcap}</span>
                </div>
              </div>

              {/* Center: Grade bars with dimension labels */}
              <div className="isc-row-bars">
                {DIMENSIONS.map(dim => {
                  const grade = card.grades[dim.id]
                  const color = GRADE_COLOR[grade] || '#FBBF24'
                  const score = GRADE_SCORE[grade] || 50

                  return (
                    <div key={dim.id} className="isc-bar-cell">
                      <div className="isc-bar-track">
                        <div
                          className="isc-bar-fill"
                          style={{
                            width: isVisible ? `${score}%` : '0%',
                            background: `linear-gradient(90deg, ${color}50, ${color})`,
                            boxShadow: isVisible ? `0 0 8px ${color}25` : 'none',
                            transitionDelay: `${i * 60 + 200}ms`,
                          }}
                        />
                      </div>
                      <span className="isc-bar-grade" style={{ color }}>{grade}</span>
                      <span className="isc-bar-dim-label">{dim.label}</span>
                    </div>
                  )
                })}
              </div>

              {/* Right: Insight */}
              <div className="isc-row-insight">
                <div className="isc-row-insight-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <p className="isc-row-insight-text">{card.insight}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Detail Popup ── */}
      {selectedCard && createPortal((() => {
        const card = selectedCard
        const ext = card.extended || {}
        const overallColor = GRADE_COLOR[card.overall] || '#FBBF24'
        const logo = card.logo || getTokenLogo(card.symbol)
        const prevGrade = ext.prevGrade
        const gradeChanged = prevGrade && prevGrade !== card.overall
        const gradeImproved = gradeChanged && (GRADE_SCORE[card.overall] || 0) > (GRADE_SCORE[prevGrade] || 0)

        return (
          <div className="isc-detail-overlay" onClick={() => setSelectedCard(null)}>
            <div className="isc-detail" onClick={e => e.stopPropagation()}>
              {/* Top accent edge - grade-colored bell-curve */}
              <div
                className="isc-detail-accent"
                style={{ background: `linear-gradient(90deg, transparent, ${overallColor}40, transparent)` }}
              />

              {/* Top edge highlight - Apple inset glow */}
              <div className="isc-detail-edge-hl" />

              {/* Ambient glow behind header */}
              <div
                className="isc-detail-glow"
                style={{ background: `radial-gradient(ellipse 200px 80px at 80px 40px, ${overallColor}12, transparent)` }}
              />

              {/* Close button */}
              <button className="isc-detail-close" onClick={() => setSelectedCard(null)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>

              {/* Header */}
              <div className="isc-detail-header">
                <GradeArc grade={card.overall} color={overallColor} isVisible={true} />
                <div className="isc-detail-identity">
                  <div className="isc-detail-token-row">
                    {logo ? (
                      <img className="isc-detail-logo" src={logo} alt={card.symbol} />
                    ) : (
                      <div className="isc-detail-logo isc-detail-logo--fallback">
                        {card.symbol.charAt(0)}
                      </div>
                    )}
                    <span className="isc-detail-symbol">{card.symbol}</span>
                    <span className="isc-detail-name">{card.name}</span>
                  </div>
                  <div className="isc-detail-meta">
                    <span className="isc-detail-sector">{card.sector}</span>
                    <span className="isc-detail-mcap">{card.mcap}</span>
                    {gradeChanged && (
                      <span className={`isc-detail-trend ${gradeImproved ? 'is-up' : 'is-down'}`}>
                        {gradeImproved ? '\u25B2' : '\u25BC'} {prevGrade} - {card.overall}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Gradient separator */}
              <div className="isc-detail-sep" />

              {/* Key Metrics row */}
              {ext.metrics && (
                <div className="isc-detail-metrics">
                  {Object.entries(ext.metrics).map(([key, val]) => (
                    <div key={key} className="isc-detail-metric">
                      <span className="isc-detail-metric-label">{METRIC_LABELS[key] || key}</span>
                      <span className="isc-detail-metric-value">{val}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Gradient separator */}
              <div className="isc-detail-sep" />

              {/* Two-column body: Dimensions (left) | Insight + Catalysts/Risks (right) */}
              <div className="isc-detail-body">
                {/* Left: Dimension breakdown */}
                <div className="isc-detail-body-left">
                  <div className="isc-detail-section">
                    <h4 className="isc-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Dimension Breakdown
                    </h4>
                    <div className="isc-detail-dims">
                      {DIMENSIONS.map((dim, di) => {
                        const grade = card.grades[dim.id]
                        const color = GRADE_COLOR[grade] || '#FBBF24'
                        const score = GRADE_SCORE[grade] || 50
                        const note = ext.dimensionNotes?.[dim.id]

                        return (
                          <div key={dim.id} className="isc-detail-dim" style={{ animationDelay: `${di * 60 + 200}ms` }}>
                            <div className="isc-detail-dim-header">
                              <span className="isc-detail-dim-label">{dim.label}</span>
                              <span className="isc-detail-dim-grade" style={{ color }}>{grade}</span>
                            </div>
                            <div className="isc-detail-dim-bar-track">
                              <div
                                className="isc-detail-dim-bar-fill"
                                style={{
                                  width: `${score}%`,
                                  background: `linear-gradient(90deg, ${color}50, ${color})`,
                                  boxShadow: `0 0 10px ${color}20`,
                                  transitionDelay: `${di * 80 + 300}ms`,
                                }}
                              />
                            </div>
                            {note && <p className="isc-detail-dim-note">{note}</p>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Right: Insight + Catalysts + Risks */}
                <div className="isc-detail-body-right">
                  {/* Analyst Insight */}
                  <div className="isc-detail-section">
                    <h4 className="isc-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Analyst Insight
                    </h4>
                    <p className="isc-detail-insight">{card.insight}</p>
                  </div>

                  {/* Catalysts */}
                  {ext.catalysts && (
                    <div className="isc-detail-section">
                      <h4 className="isc-detail-section-title isc-detail-section-title--bull">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        Catalysts
                      </h4>
                      <ul className="isc-detail-list isc-detail-list--bull">
                        {ext.catalysts.map((item, j) => <li key={j}>{item}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Risk Factors */}
                  {ext.risks && (
                    <div className="isc-detail-section">
                      <h4 className="isc-detail-section-title isc-detail-section-title--bear">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                        </svg>
                        Risk Factors
                      </h4>
                      <ul className="isc-detail-list isc-detail-list--bear">
                        {ext.risks.map((r, j) => <li key={j}>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Socials - bottom right */}
                  {ext.socials && Object.keys(ext.socials).length > 0 && (
                    <div className="isc-detail-socials">
                      {Object.entries(ext.socials).map(([key, url]) => {
                        const icon = SOCIAL_ICONS[key]
                        if (!icon) return null
                        return (
                          <a
                            key={key}
                            className="isc-detail-social"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={key.charAt(0).toUpperCase() + key.slice(1)}
                            onClick={e => e.stopPropagation()}
                          >
                            <svg width="14" height="14" viewBox={icon.viewBox}>
                              {icon.paths.map((d, pi) => (
                                <path key={pi} d={d} fill={icon.fill ? 'currentColor' : 'none'} stroke={icon.fill ? 'none' : 'currentColor'} strokeWidth={icon.fill ? undefined : '2'} />
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
          </div>
        )
      })(), document.body)}
    </div>
  )
}

export default InstitutionalScorecard
