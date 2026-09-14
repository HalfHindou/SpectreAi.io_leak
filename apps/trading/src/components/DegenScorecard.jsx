/**
 * DegenScorecard - "Meme Score"
 * Meme coin quality ratings modeled after Morningstar/S&P.
 * Five meme-specific dimensions:
 *   Community · Liquidity · Distribution · Hype · Safety
 *
 * Glass card design with SVG arc gauges for overall score,
 * animated bar fills, and cinematic blur-in entrance.
 */
import React, { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTokenLogo } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './DegenScorecard.css'

const DIM_TIPS = {
  'Community': 'Social following, engagement rate, CT mindshare, and community growth velocity.',
  'Liquidity': 'LP depth and lock status. How easily the token can be traded without slippage.',
  'Distribution': 'Holder spread. Low whale concentration means healthier, less manipulable token.',
  'Hype': 'Social velocity - mentions per hour, trend direction, viral potential.',
  'Safety': 'Contract audit status, deployer history, rug risk assessment.',
}

/* ── Grade dimensions ── */
const DIMENSIONS = [
  { id: 'community', label: 'Community', desc: 'Social strength' },
  { id: 'liquidity', label: 'Liquidity', desc: 'LP depth' },
  { id: 'distribution', label: 'Distribution', desc: 'Holder spread' },
  { id: 'hype', label: 'Hype', desc: 'Social velocity' },
  { id: 'safety', label: 'Safety', desc: 'Rug check' },
]

/* ── Grade colors ── */
const GRADE_COLOR = {
  'A+': '#10B981', 'A': '#10B981', 'A-': '#10B981',
  'B+': '#34D399', 'B': '#FBBF24', 'B-': '#FBBF24',
  'C+': '#F59E0B', 'C': '#F97316', 'C-': '#F97316',
  'D+': '#EF4444', 'D': '#EF4444', 'F': '#EF4444',
}

/* Numeric score 0-100 for bar width + arc fill */
const GRADE_SCORE = {
  'A+': 98, 'A': 92, 'A-': 87,
  'B+': 82, 'B': 75, 'B-': 68,
  'C+': 62, 'C': 55, 'C-': 48,
  'D+': 40, 'D': 35, 'F': 15,
}

/* ── Social icon SVG paths ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', fill: false, paths: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z'] },
  x: { viewBox: '0 0 24 24', fill: true, paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'] },
  telegram: { viewBox: '0 0 24 24', fill: true, paths: ['M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'] },
  discord: { viewBox: '0 0 24 24', fill: true, paths: ['M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z'] },
}

/* ── Meme scorecard data (static fallback) ── */
const SCORECARDS = [
  {
    symbol: 'DOGE', name: 'Dogecoin',
    overall: 'B+', category: 'Animal', mcap: '$22B', chain: 'Dogecoin',
    grades: { community: 'A+', liquidity: 'A', distribution: 'D+', hype: 'B', safety: 'A' },
    insight: 'The original memecoin. Massive community but extreme whale concentration. Elon narrative exhausted for now.',
    extended: {
      prevGrade: 'B+',
      metrics: { holders: '5.8M', volume24h: '$1.2B', socialFollowers: '3.9M', topWhale: '28%' },
      socials: { website: 'https://dogecoin.com', x: 'https://x.com/dogecoin' },
      dimensionNotes: {
        community: 'Largest meme community globally. 3.9M X followers. Elon amplifies reach but creates dependency.',
        liquidity: 'Deep CEX books on every major exchange. DEX liquidity limited since DOGE is its own chain.',
        distribution: 'Extreme whale concentration - one wallet holds 28% of supply. Top 20 wallets hold 48%.',
        hype: 'Steady baseline mentions but viral spikes require Elon catalyst. Social velocity declining from peak.',
        safety: 'PoW chain since 2013. Battle-tested, fully decentralized. No smart contract risk.',
      },
      catalysts: [
        'X payments integration rumor resurfaces periodically',
        'ETF narrative - Grayscale DOGE trust filing',
        'DOGE-ETH bridge enabling DeFi participation',
      ],
      risks: [
        'Single wallet controls 28% of supply - manipulation risk',
        'No development roadmap or protocol upgrades',
        'Price action almost entirely sentiment-driven',
      ],
    },
  },
  {
    symbol: 'PEPE', name: 'Pepe',
    overall: 'B', category: 'Culture', mcap: '$4.2B', chain: 'Ethereum',
    grades: { community: 'A', liquidity: 'A-', distribution: 'B', hype: 'B-', safety: 'A-' },
    insight: 'Ethereum OG meme with cultural staying power. Contract renounced, LP burned. Distribution phase underway.',
    extended: {
      prevGrade: 'B+',
      metrics: { holders: '280K', volume24h: '$420M', socialFollowers: '620K', topWhale: '5.2%' },
      socials: { website: 'https://pepecoin.io', x: 'https://x.com/pepecoineth', telegram: 'https://telegram.me/pepecoineth' },
      dimensionNotes: {
        community: 'Massive CT presence. Pepe meme transcends crypto - cultural moat is real. 620K X followers.',
        liquidity: 'Deep Uniswap v3 pool. CEX liquidity on Binance, Coinbase, OKX. <0.1% slippage on $100K trades.',
        distribution: 'Healthy spread post-launch redistribution. Top wallet 5.2%, top 100 hold ~35%. Improving.',
        hype: 'Declining from ATH mindshare. Still top 5 meme by social volume but momentum is down.',
        safety: 'Contract renounced. LP tokens burned. No owner functions. ERC-20 standard - fully auditable.',
      },
      catalysts: [
        'Pepe PEPE chain L2 rumors - would add DeFi utility',
        'Cultural moment catalyst (unpredictable viral event)',
        'CEX listing on remaining tier 1 exchanges',
      ],
      risks: [
        'Distribution phase - smart money reducing exposure',
        'Ethereum gas costs limit retail participation during spikes',
        'No utility or development roadmap beyond meme status',
      ],
    },
  },
  {
    symbol: 'WIF', name: 'dogwifhat',
    overall: 'B', category: 'Animal', mcap: '$2.8B', chain: 'Solana',
    grades: { community: 'A-', liquidity: 'B+', distribution: 'B+', hype: 'B+', safety: 'B+' },
    insight: 'Solana meme blue chip. Clean distribution, strong community, but approaching peak mindshare.',
    extended: {
      prevGrade: 'B-',
      metrics: { holders: '185K', volume24h: '$320M', socialFollowers: '280K', topWhale: '3.8%' },
      socials: { website: 'https://dogwifcoin.org', x: 'https://x.com/dogwifcoin', telegram: 'https://telegram.me/dogwifcoin' },
      dimensionNotes: {
        community: 'Top 3 Solana meme by mindshare. Active CT community, strong meme culture. Organic growth.',
        liquidity: 'Primary liquidity on Raydium and Orca. CEX listed on Binance, Bybit. Adequate for size.',
        distribution: 'Healthy holder spread. No single wallet above 4%. Community-driven from inception.',
        hype: 'High baseline social activity. Las Vegas Sphere stunt cemented cultural status. Steady but not accelerating.',
        safety: 'SPL token on Solana. Mint authority revoked. LP partially locked. Clean deployer history.',
      },
      catalysts: [
        'Solana ecosystem growth lifting all boats',
        'Potential Coinbase listing (not yet listed)',
        'Meme supercycle narrative if BTC breaks ATH',
      ],
      risks: [
        'Approaching late-cycle for this meme wave',
        'Solana congestion during peak trading',
        'New Solana memes cannibalizing attention',
      ],
    },
  },
  {
    symbol: 'BONK', name: 'Bonk',
    overall: 'B+', category: 'Animal', mcap: '$2.1B', chain: 'Solana',
    grades: { community: 'A', liquidity: 'B+', distribution: 'A-', hype: 'B', safety: 'A-' },
    insight: 'Most integrated Solana meme. BonkBot driving real utility. DAO-governed with excellent distribution.',
    extended: {
      prevGrade: 'B',
      metrics: { holders: '820K', volume24h: '$180M', socialFollowers: '420K', topWhale: '2.4%' },
      socials: { website: 'https://bonkcoin.com', x: 'https://x.com/bonk_inu', telegram: 'https://telegram.me/Official_Bonk', discord: 'https://discord.gg/bonk' },
      dimensionNotes: {
        community: 'Largest Solana meme community. 820K holders. DAO structure creates genuine decentralized culture.',
        liquidity: 'Deep Solana DEX pools. CEX liquidity growing. BonkBot contributes significant trading volume.',
        distribution: 'Best-in-class for memes. Airdropped to Solana community. Top wallet only 2.4%. Very healthy.',
        hype: 'Steady organic mentions. BonkBot usage keeps baseline activity high even during meme downturns.',
        safety: 'DAO-governed. Token burn events reducing supply. Multiple audits. Mint authority burned.',
      },
      catalysts: [
        'BonkBot expanding to more chains and DEX aggregation',
        'Bonk DAO treasury deploying capital for ecosystem growth',
        'Token burn schedule accelerating deflationary pressure',
      ],
      risks: [
        'Utility narrative may not sustain in pure meme downturn',
        'DAO governance can be slow and contentious',
        'Competition from new Solana meme trading bots',
      ],
    },
  },
  {
    symbol: 'SHIB', name: 'Shiba Inu',
    overall: 'C+', category: 'Animal', mcap: '$8.6B', chain: 'Ethereum',
    grades: { community: 'A', liquidity: 'A-', distribution: 'C+', hype: 'C', safety: 'B+' },
    insight: 'Legacy meme with utility pivot via Shibarium L2. Massive holder base but declining engagement.',
    extended: {
      prevGrade: 'B-',
      metrics: { holders: '1.4M', volume24h: '$280M', socialFollowers: '3.6M', topWhale: '7.1%' },
      socials: { website: 'https://shibatoken.com', x: 'https://x.com/Shibtoken', telegram: 'https://telegram.me/ShibaInu_Dogecoinkiller', discord: 'https://discord.gg/shibatoken' },
      dimensionNotes: {
        community: 'Second largest meme community. 3.6M X followers. But engagement rate declining - passive holders.',
        liquidity: 'Deep CEX liquidity everywhere. DEX liquidity via Uniswap and ShibaSwap. No slippage concerns.',
        distribution: 'Vitalik burn reduced supply concentration. But dead wallets inflate holder count. Real active ~200K.',
        hype: 'Declining mindshare. CT has moved on to newer memes. Shibarium updates get minimal attention.',
        safety: 'Contract audited. Renounced ownership. Shibarium L2 adds complexity but core token is safe.',
      },
      catalysts: [
        'Shibarium TVL growth if DeFi deploys on L2',
        'BONE/LEASH ecosystem creating utility flywheel',
        'Retail FOMO if meme sector rallies broadly',
      ],
      risks: [
        'Declining developer activity on Shibarium',
        'Holder count inflated by dust wallets',
        'New meme cycles pulling attention permanently',
      ],
    },
  },
  {
    symbol: 'FLOKI', name: 'Floki Inu',
    overall: 'C+', category: 'Animal', mcap: '$1.8B', chain: 'Ethereum + BNB',
    grades: { community: 'B+', liquidity: 'B', distribution: 'B-', hype: 'B', safety: 'B' },
    insight: 'Cross-chain meme with gaming and DeFi utility plays. Aggressive marketing budget driving awareness.',
    extended: {
      prevGrade: 'C',
      metrics: { holders: '480K', volume24h: '$82M', socialFollowers: '850K', topWhale: '4.8%' },
      socials: { website: 'https://floki.com', x: 'https://x.com/RealFlokiInu', telegram: 'https://telegram.me/FlokiInuToken' },
      dimensionNotes: {
        community: 'Active across X and Telegram. 850K followers. Marketing-driven growth rather than fully organic.',
        liquidity: 'Split between Ethereum and BNB Chain. Adequate depth on Uniswap and PancakeSwap. CEX listed.',
        distribution: 'Doxxed team holds portion. Burns ongoing. Top wallets reasonable but team allocation unclear.',
        hype: 'Steady marketing presence. Valhalla game beta generating some buzz. Football sponsorships drive reach.',
        safety: 'Multi-chain deployment increases complexity. Doxxed team is positive. Multiple audits completed.',
      },
      catalysts: [
        'Valhalla game full launch attracting GameFi attention',
        'FlokiFi DeFi suite gaining TVL',
        'Marketing partnerships with sports brands',
      ],
      risks: [
        'Heavy reliance on paid marketing over organic growth',
        'Multi-chain splits liquidity and community focus',
        'Gaming product quality unproven at scale',
      ],
    },
  },
  {
    symbol: 'TRUMP', name: 'MAGA',
    overall: 'D+', category: 'Political', mcap: '$580M', chain: 'Solana',
    grades: { community: 'B+', liquidity: 'C+', distribution: 'D', hype: 'A', safety: 'D' },
    insight: 'Extreme event-driven meme. Massive hype velocity but severe whale concentration and unknown deployer.',
    extended: {
      prevGrade: 'D',
      metrics: { holders: '62.4K', volume24h: '$142M', socialFollowers: '180K', topWhale: '22.1%' },
      socials: { x: 'https://x.com/MAGAMemecoin' },
      dimensionNotes: {
        community: 'Politically motivated community. Engagement spikes around news cycle. Tribal, loyal, but niche.',
        liquidity: 'Concentrated on Solana DEXs. Some CEX listings but depth is shallow relative to volume.',
        distribution: 'Severe whale concentration. Top wallet holds 22.1%. Insider activity suspected. High manipulation risk.',
        hype: 'Highest social velocity during political events. Mentions 8K+/hr during catalysts. Extremely volatile.',
        safety: 'Unknown deployer. LP not locked. No audit. Contract is standard but deployer history is opaque.',
      },
      catalysts: [
        'Election cycle news events drive predictable pumps',
        'Political endorsement or controversy catalyst',
        'Broader political meme narrative if sector rotates',
      ],
      risks: [
        'Top wallet can dump 22% of supply at any time',
        'LP unlocked - theoretical rug risk exists',
        'Regulatory scrutiny on political tokens',
      ],
    },
  },
  {
    symbol: 'POPCAT', name: 'Popcat',
    overall: 'C', category: 'Animal', mcap: '$420M', chain: 'Solana',
    grades: { community: 'B', liquidity: 'C+', distribution: 'B', hype: 'B+', safety: 'B' },
    insight: 'Rising Solana cat meme. Clean deployer, decent distribution. Early stage with room to grow.',
    extended: {
      prevGrade: 'C-',
      metrics: { holders: '18.2K', volume24h: '$34M', socialFollowers: '45K', topWhale: '8.2%' },
      socials: { website: 'https://popcatsolana.com', x: 'https://x.com/Popcatsolana', telegram: 'https://telegram.me/popcatsolana' },
      dimensionNotes: {
        community: 'Growing fast. 45K followers but high engagement rate. Cat meta narrative supporting momentum.',
        liquidity: 'Primarily Raydium. Thin LP relative to market cap. Slippage above 1% on $50K+ trades.',
        distribution: 'Reasonable for a newer meme. No insider wallets detected. Organic launch pattern.',
        hype: 'Rising social velocity. Cat meme meta is active. Good meme format for viral potential.',
        safety: 'Clean deployer - no prior rugs. Mint authority revoked. LP partially locked at 92%.',
      },
      catalysts: [
        'Cat meme meta cycle if it persists',
        'CEX listing catalysts (limited listings currently)',
        'Cross-pollination with Popcat internet meme culture',
      ],
      risks: [
        'Thin liquidity - vulnerable to whale dumps',
        'Cat meme meta could be short-lived',
        'Competition from MEW and other cat tokens',
      ],
    },
  },
]

/* ── SVG Arc Gauge for overall grade ── */
function GradeArc({ grade, color, isVisible }) {
  const score = GRADE_SCORE[grade] || 50
  const r = 24
  const c = 2 * Math.PI * r
  const arcPct = 0.75
  const arcLen = c * arcPct
  const offset = arcLen - (score / 100) * arcLen
  return (
    <div className="dsc-grade-arc">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle
          className="dsc-grade-arc-track"
          cx="28" cy="28" r={r}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="3"
          strokeDasharray={`${arcLen} ${c - arcLen}`}
          strokeLinecap="round"
          transform="rotate(135 28 28)"
        />
        <circle
          cx="28" cy="28" r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${arcLen} ${c - arcLen}`}
          strokeDashoffset={isVisible ? offset : arcLen}
          strokeLinecap="round"
          transform="rotate(135 28 28)"
          className="dsc-grade-arc-fill"
          style={{ filter: `drop-shadow(0 0 4px ${color}40)` }}
        />
      </svg>
      <span className="dsc-grade-arc-letter" style={{ color }}>
        {grade}
      </span>
    </div>
  )
}

function DegenScorecard({ scorecards, activeSymbol, selectToken }) {
  const [visibleCards, setVisibleCards] = useState(new Set())
  const [selectedCard, setSelectedCard] = useState(null)
  const cardRefs = useRef({})

  // Use dynamic scorecards when present, else fall back to the static set
  const cardData = Array.isArray(scorecards) && scorecards.length ? scorecards : SCORECARDS

  // Escape key + body scroll lock
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
    <div className="dsc">
      {/* Dimension column headers */}
      <div className="dsc-dim-headers">
        <div className="dsc-dim-headers-spacer" />
        <div className="dsc-dim-headers-row">
          {DIMENSIONS.map(dim => (
            <div key={dim.id} className="dsc-dim-header">
              <span className="dsc-dim-header-label">{dim.label}<InfoTip text={DIM_TIPS[dim.label]} position="bottom" /></span>
              <span className="dsc-dim-header-desc">{dim.desc}</span>
            </div>
          ))}
        </div>
        <div className="dsc-dim-headers-spacer-right" />
      </div>

      {/* Scorecard rows */}
      <div className="dsc-list">
        {cardData.map((card, i) => {
          const logo = getTokenLogo(card.symbol)
          const overallColor = GRADE_COLOR[card.overall] || '#FBBF24'
          const isVisible = visibleCards.has(card.symbol)
          const grades = card.grades || {}

          return (
            <div
              key={card.symbol}
              className={`dsc-row ${isVisible ? 'is-visible' : ''} ${activeSymbol && card.symbol === activeSymbol ? 'is-highlighted' : ''} ${activeSymbol && card.symbol !== activeSymbol ? 'is-dimmed' : ''}`}
              data-symbol={card.symbol}
              ref={el => cardRefs.current[card.symbol] = el}
              style={{ transitionDelay: `${i * 60}ms` }}
              onClick={() => setSelectedCard(card)}
            >
              <div className="dsc-row-accent" style={{ background: `linear-gradient(90deg, transparent, ${overallColor}30, transparent)` }} />

              {/* Left: Grade arc + Token identity */}
              <div className="dsc-row-left">
                <GradeArc grade={card.overall} color={overallColor} isVisible={isVisible} />
                <div className="dsc-row-token">
                  {logo ? (
                    <img className="dsc-row-logo" src={logo} alt={card.symbol} />
                  ) : (
                    <div className="dsc-row-logo dsc-row-logo--fallback">{card.symbol?.charAt(0) || '?'}</div>
                  )}
                  <div className="dsc-row-names">
                    <span className="dsc-row-symbol">{card.symbol}</span>
                    <span className="dsc-row-name">{card.name}</span>
                  </div>
                </div>
                <div className="dsc-row-meta">
                  <span className="dsc-row-category">{card.category}</span>
                  <span className="dsc-row-mcap">{card.mcap}</span>
                </div>
              </div>

              {/* Center: Grade bars */}
              <div className="dsc-row-bars">
                {DIMENSIONS.map(dim => {
                  const grade = grades[dim.id]
                  const color = GRADE_COLOR[grade] || '#FBBF24'
                  const score = GRADE_SCORE[grade] || 50
                  return (
                    <div key={dim.id} className="dsc-bar-cell">
                      <div className="dsc-bar-track">
                        <div
                          className="dsc-bar-fill"
                          style={{
                            width: isVisible ? `${score}%` : '0%',
                            background: `linear-gradient(90deg, ${color}50, ${color})`,
                            boxShadow: isVisible ? `0 0 8px ${color}25` : 'none',
                            transitionDelay: `${i * 60 + 200}ms`,
                          }}
                        />
                      </div>
                      <span className="dsc-bar-grade" style={{ color }}>{grade}</span>
                      <span className="dsc-bar-dim-label">{dim.label}</span>
                    </div>
                  )
                })}
              </div>

              {/* Right: Insight */}
              <div className="dsc-row-insight">
                <div className="dsc-row-insight-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <path d="M9 9h.01M15 9h.01" />
                  </svg>
                </div>
                <p className="dsc-row-insight-text">{card.insight}</p>
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
        const logo = getTokenLogo(card.symbol)

        return (
          <div className="dsc-detail-overlay" onClick={() => setSelectedCard(null)}>
            <div className="dsc-detail" onClick={e => e.stopPropagation()}>
              <div className="dsc-detail-accent" style={{ background: `linear-gradient(90deg, transparent, ${overallColor}40, transparent)` }} />
              <div className="dsc-detail-edge-hl" />

              <button className="dsc-detail-close" onClick={() => setSelectedCard(null)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>

              {/* Header */}
              <div className="dsc-detail-header">
                <GradeArc grade={card.overall} color={overallColor} isVisible={true} />
                <div className="dsc-detail-identity">
                  <div className="dsc-detail-name-row">
                    {logo ? (
                      <img className="dsc-detail-logo" src={logo} alt={card.symbol} />
                    ) : (
                      <div className="dsc-detail-logo dsc-detail-logo--fallback">{card.symbol?.charAt(0) || '?'}</div>
                    )}
                    <span className="dsc-detail-symbol">{card.symbol}</span>
                    <span className="dsc-detail-name">{card.name}</span>
                  </div>
                  <div className="dsc-detail-meta">
                    <span className="dsc-detail-category">{card.category}</span>
                    <span className="dsc-detail-chain">{card.chain}</span>
                    <span className="dsc-detail-mcap">{card.mcap}</span>
                    {ext.prevGrade && (
                      <span className="dsc-detail-prev-grade">
                        Prev: <span style={{ color: GRADE_COLOR[ext.prevGrade] }}>{ext.prevGrade}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="dsc-detail-sep" />

              {/* Metrics row */}
              {ext.metrics && (
                <div className="dsc-detail-metrics">
                  {Object.entries(ext.metrics).map(([key, val]) => {
                    const labelMap = { holders: 'Holders', volume24h: '24h Volume', socialFollowers: 'Social Followers', topWhale: 'Top Whale' }
                    return (
                      <div key={key} className="dsc-detail-metric">
                        <span className="dsc-detail-metric-label">{labelMap[key] || key}</span>
                        <span className="dsc-detail-metric-value">{val}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="dsc-detail-sep" />

              {/* Dimension breakdowns */}
              <div className="dsc-detail-body">
                <div className="dsc-detail-body-left">
                  <div className="dsc-detail-section">
                    <h4 className="dsc-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 3v18h18" />
                        <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
                      </svg>
                      Dimension Breakdown
                    </h4>
                    <div className="dsc-detail-dims">
                      {DIMENSIONS.map(dim => {
                        const grade = (card.grades || {})[dim.id]
                        const color = GRADE_COLOR[grade] || '#FBBF24'
                        const score = GRADE_SCORE[grade] || 50
                        const note = ext.dimensionNotes?.[dim.id]
                        return (
                          <div key={dim.id} className="dsc-detail-dim">
                            <div className="dsc-detail-dim-header">
                              <span className="dsc-detail-dim-label">{dim.label}</span>
                              <div className="dsc-detail-dim-bar-wrap">
                                <div className="dsc-detail-dim-bar-track">
                                  <div className="dsc-detail-dim-bar-fill" style={{ width: `${score}%`, background: `linear-gradient(90deg, ${color}50, ${color})` }} />
                                </div>
                                <span className="dsc-detail-dim-grade" style={{ color }}>{grade}</span>
                              </div>
                            </div>
                            {note && <p className="dsc-detail-dim-note">{note}</p>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="dsc-detail-body-right">
                  {/* Insight */}
                  <div className="dsc-detail-section">
                    <h4 className="dsc-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <path d="M9 9h.01M15 9h.01" />
                      </svg>
                      Analysis
                    </h4>
                    <p className="dsc-detail-insight">{card.insight}</p>
                  </div>

                  {ext.catalysts && (
                    <div className="dsc-detail-section">
                      <h4 className="dsc-detail-section-title dsc-detail-section-title--bull">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        Catalysts
                      </h4>
                      <ul className="dsc-detail-list dsc-detail-list--bull">
                        {ext.catalysts.map((c, ci) => <li key={ci}>{c}</li>)}
                      </ul>
                    </div>
                  )}

                  {ext.risks && (
                    <div className="dsc-detail-section">
                      <h4 className="dsc-detail-section-title dsc-detail-section-title--bear">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                        </svg>
                        Risk Factors
                      </h4>
                      <ul className="dsc-detail-list dsc-detail-list--bear">
                        {ext.risks.map((r, ri) => <li key={ri}>{r}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Socials */}
                  {ext.socials && (
                    <div className="dsc-detail-socials">
                      {Object.entries(ext.socials).map(([key, url]) => {
                        const icon = SOCIAL_ICONS[key]
                        if (!icon) return null
                        return (
                          <a key={key} className="dsc-detail-social" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                            <svg viewBox={icon.viewBox} {...(icon.fill ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })}>
                              {icon.paths.map((d, pi) => <path key={pi} d={d} />)}
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

export default DegenScorecard
