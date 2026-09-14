/**
 * MemeFlowPipeline - "The Meme Pipeline"
 * Meme coin lifecycle tracker modeled after VC deal flow.
 * Tracks memes through four stages:
 *   Fresh Mint → Gaining Traction → Going Viral → Take Profit
 *
 * Each card shows social velocity, holder growth, LP status,
 * deployer history, and degen-specific risk signals.
 */
import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { getTokenLogo } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './MemeFlowPipeline.css'

/* ── Social icon SVG paths ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', fill: false, paths: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z'] },
  x: { viewBox: '0 0 24 24', fill: true, paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'] },
  telegram: { viewBox: '0 0 24 24', fill: true, paths: ['M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'] },
}

const STAGE_TIPS = {
  'fresh': 'Just launched or discovered. Low holder count, unproven. High risk, high potential reward.',
  'traction': 'Growing organically. Holder count climbing, social mentions rising, community forming.',
  'viral': 'Explosive growth phase. Volume surging, CT talking, mainstream meme culture crossover.',
  'profit': 'Distribution phase. Smart money taking profits, volume declining from peak. Late entry = high risk.',
}

/* ── Meme pipeline stages ── */
const STAGES = [
  {
    id: 'fresh',
    label: 'Fresh Mint',
    subtitle: 'Just launched',
    icon: 'M12 3v18m-6-6l6 6 6-6',
    color: '#8B5CF6',
  },
  {
    id: 'traction',
    label: 'Gaining Traction',
    subtitle: 'Community growing',
    icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    color: '#10B981',
  },
  {
    id: 'viral',
    label: 'Going Viral',
    subtitle: 'Explosive growth',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    color: '#F59E0B',
  },
  {
    id: 'profit',
    label: 'Take Profit',
    subtitle: 'Distribution phase',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1',
    color: '#EF4444',
  },
]

/* ── Meme deal data (static fallback) ── */
const MEME_DEALS = [
  // Fresh Mint
  {
    id: 'm1', stage: 'fresh', symbol: 'POPCAT', name: 'Popcat',
    thesis: 'Solana-native cat meme riding the animal meme meta',
    category: 'Animal',
    risk: 'D+', riskColor: '#EF4444',
    holders: '18.2K', holderVelocity: '+2.1K/24h',
    volume24h: '$34M', lpLocked: true, lpPct: '92%',
    change24h: 42.8, mcap: '$420M',
    socialMentions: '1.2K/hr', socialTrend: 'up',
    deployer: 'Clean - no prior rugs', deployerSafe: true,
    chain: 'Solana',
    topHolderPct: '8.2%',
    signal: 'Organic growth pattern. No insider wallets detected.',
    socials: { website: 'https://popcatsolana.com', x: 'https://x.com/Popcatsolana', telegram: 'https://telegram.me/popcatsolana' },
  },
  {
    id: 'm2', stage: 'fresh', symbol: 'MEW', name: 'cat in a dogs world',
    thesis: 'Anti-dog meme narrative on Solana - contrarian cat play',
    category: 'Animal',
    risk: 'D', riskColor: '#EF4444',
    holders: '42.5K', holderVelocity: '+800/24h',
    volume24h: '$18M', lpLocked: true, lpPct: '85%',
    change24h: -8.4, mcap: '$280M',
    socialMentions: '340/hr', socialTrend: 'flat',
    deployer: 'Clean - first deployment', deployerSafe: true,
    chain: 'Solana',
    topHolderPct: '6.1%',
    signal: 'Consolidating after initial pump. Holder count still rising.',
    socials: { x: 'https://x.com/maborrowaborrowewcoin', telegram: 'https://telegram.me/maborrowaborrowewcoinsol' },
  },
  // Gaining Traction
  {
    id: 'm3', stage: 'traction', symbol: 'FLOKI', name: 'Floki Inu',
    thesis: 'Cross-chain meme with actual utility plays - gaming + DeFi',
    category: 'Animal',
    risk: 'C+', riskColor: '#FBBF24',
    holders: '480K', holderVelocity: '+3.2K/24h',
    volume24h: '$82M', lpLocked: true, lpPct: '100%',
    change24h: 14.2, mcap: '$1.8B',
    socialMentions: '2.8K/hr', socialTrend: 'up',
    deployer: 'Doxxed team', deployerSafe: true,
    chain: 'Ethereum + BNB',
    topHolderPct: '4.8%',
    signal: 'Valhalla game beta driving new holder growth. Marketing spend increasing.',
    socials: { website: 'https://floki.com', x: 'https://x.com/RealFlokiInu', telegram: 'https://telegram.me/FlokiInuToken' },
  },
  {
    id: 'm4', stage: 'traction', symbol: 'MYRO', name: 'Myro',
    thesis: "Solana co-founder's dog meme - insider narrative edge",
    category: 'Animal',
    risk: 'D+', riskColor: '#EF4444',
    holders: '28.1K', holderVelocity: '+1.5K/24h',
    volume24h: '$24M', lpLocked: true, lpPct: '88%',
    change24h: 22.6, mcap: '$120M',
    socialMentions: '890/hr', socialTrend: 'up',
    deployer: 'Clean', deployerSafe: true,
    chain: 'Solana',
    topHolderPct: '9.4%',
    signal: 'Raj Gokal association drives recurring narrative pumps.',
    socials: { website: 'https://myro.army', x: 'https://x.com/MyroSOL', telegram: 'https://telegram.me/myaborrowrmyro' },
  },
  {
    id: 'm5', stage: 'traction', symbol: 'TRUMP', name: 'MAGA',
    thesis: 'Political meme tied to 2024/2026 election cycle catalyst',
    category: 'Political',
    risk: 'D', riskColor: '#EF4444',
    holders: '62.4K', holderVelocity: '+4.8K/24h',
    volume24h: '$142M', lpLocked: false, lpPct: '0%',
    change24h: 38.1, mcap: '$580M',
    socialMentions: '8.2K/hr', socialTrend: 'up',
    deployer: 'Unknown - not doxxed', deployerSafe: false,
    chain: 'Solana',
    topHolderPct: '22.1%',
    signal: 'Extremely event-driven. Price action tied to political news cycle.',
    socials: { x: 'https://x.com/MAGAMemecoin' },
  },
  // Going Viral
  {
    id: 'm6', stage: 'viral', symbol: 'WIF', name: 'dogwifhat',
    thesis: 'The "blue chip" Solana meme - cultural icon status achieved',
    category: 'Animal',
    risk: 'C', riskColor: '#FBBF24',
    holders: '185K', holderVelocity: '+5.4K/24h',
    volume24h: '$320M', lpLocked: true, lpPct: '95%',
    change24h: -4.2, mcap: '$2.8B',
    socialMentions: '12K/hr', socialTrend: 'flat',
    deployer: 'Community-driven', deployerSafe: true,
    chain: 'Solana',
    topHolderPct: '3.8%',
    signal: 'Peak mindshare. CEX listings driving volume. Watch for distribution signals.',
    socials: { website: 'https://dogwifcoin.org', x: 'https://x.com/dogwifcoin', telegram: 'https://telegram.me/dogwifcoin' },
  },
  {
    id: 'm7', stage: 'viral', symbol: 'BONK', name: 'Bonk',
    thesis: 'Solana community token with deepest ecosystem integration',
    category: 'Animal',
    risk: 'C+', riskColor: '#FBBF24',
    holders: '820K', holderVelocity: '+2.1K/24h',
    volume24h: '$180M', lpLocked: true, lpPct: '100%',
    change24h: 8.9, mcap: '$2.1B',
    socialMentions: '6.4K/hr', socialTrend: 'up',
    deployer: 'DAO-governed', deployerSafe: true,
    chain: 'Solana',
    topHolderPct: '2.4%',
    signal: 'BonkBot driving real utility. Most integrated meme on Solana.',
    socials: { website: 'https://bonkcoin.com', x: 'https://x.com/bonk_inu', telegram: 'https://telegram.me/Official_Bonk' },
  },
  // Take Profit
  {
    id: 'm8', stage: 'profit', symbol: 'PEPE', name: 'Pepe',
    thesis: 'Ethereum OG meme - cultural staying power but showing age',
    category: 'Culture',
    risk: 'C', riskColor: '#FBBF24',
    holders: '280K', holderVelocity: '-1.2K/24h',
    volume24h: '$420M', lpLocked: true, lpPct: '100%',
    change24h: -6.8, mcap: '$4.2B',
    socialMentions: '4.1K/hr', socialTrend: 'down',
    deployer: 'Renounced', deployerSafe: true,
    chain: 'Ethereum',
    topHolderPct: '5.2%',
    signal: 'Smart money wallets reducing exposure. Volume declining from ATH.',
    socials: { website: 'https://pepecoin.io', x: 'https://x.com/pepecoineth', telegram: 'https://telegram.me/pepecoineth' },
  },
  {
    id: 'm9', stage: 'profit', symbol: 'SHIB', name: 'Shiba Inu',
    thesis: 'Legacy meme with Shibarium L2 - utility pivot narrative fading',
    category: 'Animal',
    risk: 'C-', riskColor: '#FBBF24',
    holders: '1.4M', holderVelocity: '-3.8K/24h',
    volume24h: '$280M', lpLocked: true, lpPct: '100%',
    change24h: -2.4, mcap: '$8.6B',
    socialMentions: '2.8K/hr', socialTrend: 'down',
    deployer: 'Renounced', deployerSafe: true,
    chain: 'Ethereum',
    topHolderPct: '7.1%',
    signal: 'Retail dominated. Smart money fully exited. Shibarium TVL declining.',
    socials: { website: 'https://shibatoken.com', x: 'https://x.com/Shibtoken', telegram: 'https://telegram.me/ShibaInu_Dogecoinkiller' },
  },
  {
    id: 'm10', stage: 'profit', symbol: 'DOGE', name: 'Dogecoin',
    thesis: 'The original memecoin - Elon narrative exhausted for now',
    category: 'Animal',
    risk: 'B-', riskColor: '#10B981',
    holders: '5.8M', holderVelocity: '-800/24h',
    volume24h: '$1.2B', lpLocked: true, lpPct: '100%',
    change24h: -1.8, mcap: '$22B',
    socialMentions: '3.2K/hr', socialTrend: 'down',
    deployer: 'PoW chain', deployerSafe: true,
    chain: 'Dogecoin',
    topHolderPct: '28%',
    signal: 'Elon/X payments narrative priced in. Whale concentration is extreme.',
    socials: { website: 'https://dogecoin.com', x: 'https://x.com/dogecoin' },
  },
]

function MemeFlowPipeline({ deals, activeSymbol, selectToken }) {
  const [selectedDeal, setSelectedDeal] = useState(null)
  const columnRefs = useRef({})

  // Use dynamic deals when present, else fall back to the static set
  const dealData = Array.isArray(deals) && deals.length ? deals : MEME_DEALS

  // Escape key closes detail popup + body scroll lock
  useEffect(() => {
    if (!selectedDeal) return
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarW}px`
    const onKey = (e) => { if (e.key === 'Escape') setSelectedDeal(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [selectedDeal])

  return (
    <div className="mfp">
      {/* Kanban columns */}
      <div className="mfp-board">
        {STAGES.map(stage => {
          const deals = dealData.filter(d => d.stage === stage.id)
          return (
            <div
              key={stage.id}
              className="mfp-column"
              ref={el => columnRefs.current[stage.id] = el}
            >
              {/* Column header */}
              <div className="mfp-column-header">
                <div className="mfp-column-icon" style={{ color: stage.color, background: `${stage.color}12`, borderColor: `${stage.color}20` }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={stage.icon} />
                  </svg>
                </div>
                <div className="mfp-column-info">
                  <span className="mfp-column-label">
                    {stage.label}
                    <InfoTip text={STAGE_TIPS[stage.id]} position="bottom" />
                  </span>
                  <span className="mfp-column-subtitle">{stage.subtitle}</span>
                </div>
                <span className="mfp-column-count">{deals.length}</span>
              </div>

              {/* Cards */}
              <div className="mfp-cards">
                {deals.map((deal, i) => {
                  const logo = getTokenLogo(deal.symbol)
                  const isHighlighted = activeSymbol && deal.symbol && deal.symbol.toUpperCase() === activeSymbol.toUpperCase()
                  return (
                    <div
                      key={deal.id}
                      className={`mfp-card ${isHighlighted ? 'is-highlighted' : ''}`}
                      style={{ animationDelay: `${i * 80}ms` }}
                      onClick={() => setSelectedDeal(deal)}
                    >
                      {/* Card accent */}
                      <div className="mfp-card-accent" style={{ background: `linear-gradient(90deg, transparent, ${stage.color}30, transparent)` }} />

                      {/* Header row */}
                      <div className="mfp-card-header">
                        <div className="mfp-card-identity">
                          {logo ? (
                            <img className="mfp-card-logo" src={logo} alt={deal.symbol} />
                          ) : (
                            <div className="mfp-card-logo mfp-card-logo--fallback">{deal.symbol?.charAt(0) || '?'}</div>
                          )}
                          <div className="mfp-card-names">
                            <span className="mfp-card-symbol">{deal.symbol}</span>
                            <span className="mfp-card-name">{deal.name}</span>
                          </div>
                        </div>
                        <div className="mfp-card-badges">
                          <span className="mfp-card-category">{deal.category}</span>
                          <span className="mfp-card-risk" style={{ color: deal.riskColor, borderColor: `${deal.riskColor}30` }}>{deal.risk}</span>
                        </div>
                      </div>

                      {/* Thesis */}
                      <p className="mfp-card-thesis">{deal.thesis}</p>

                      {/* Metrics grid */}
                      <div className="mfp-card-metrics">
                        <div className="mfp-card-metric">
                          <span className="mfp-card-metric-label">MCap</span>
                          <span className="mfp-card-metric-value">{deal.mcap}</span>
                        </div>
                        <div className="mfp-card-metric">
                          <span className="mfp-card-metric-label">24h Vol</span>
                          <span className="mfp-card-metric-value">{deal.volume24h}</span>
                        </div>
                        <div className="mfp-card-metric">
                          <span className="mfp-card-metric-label">Holders</span>
                          <span className="mfp-card-metric-value">{deal.holders}</span>
                        </div>
                        <div className="mfp-card-metric">
                          <span className="mfp-card-metric-label">24h</span>
                          <span className={`mfp-card-metric-value ${deal.change24h >= 0 ? 'is-bull' : 'is-bear'}`}>
                            {deal.change24h >= 0 ? '+' : ''}{deal.change24h}%
                          </span>
                        </div>
                      </div>

                      {/* Safety indicators */}
                      <div className="mfp-card-safety">
                        <span className={`mfp-card-safety-tag ${deal.lpLocked ? 'is-safe' : 'is-warn'}`}>
                          {deal.lpLocked ? `LP ${deal.lpPct || '-'}` : 'LP Unlocked'}
                        </span>
                        <span className={`mfp-card-safety-tag ${deal.deployerSafe ? 'is-safe' : 'is-warn'}`}>
                          {deal.deployerSafe ? 'Clean' : 'Caution'}
                        </span>
                        {deal.socialMentions && (
                          <span className={`mfp-card-safety-tag ${deal.socialTrend === 'up' ? 'is-hot' : deal.socialTrend === 'down' ? 'is-cold' : ''}`}>
                            {deal.socialMentions}
                          </span>
                        )}
                      </div>

                      {/* Signal */}
                      <div className="mfp-card-signal">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>{deal.signal}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Detail Popup ── */}
      {selectedDeal && createPortal((() => {
        const deal = selectedDeal
        const stage = STAGES.find(s => s.id === deal.stage)
        const logo = getTokenLogo(deal.symbol)

        return (
          <div className="mfp-detail-overlay" onClick={() => setSelectedDeal(null)}>
            <div className="mfp-detail" onClick={e => e.stopPropagation()}>
              {/* Accent edge */}
              <div className="mfp-detail-accent" style={{ background: `linear-gradient(90deg, transparent, ${stage?.color || '#fff'}40, transparent)` }} />
              <div className="mfp-detail-edge-hl" />

              {/* Close */}
              <button className="mfp-detail-close" onClick={() => setSelectedDeal(null)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>

              {/* Header */}
              <div className="mfp-detail-header">
                <div className="mfp-detail-logo-wrap">
                  {logo ? (
                    <img className="mfp-detail-logo" src={logo} alt={deal.symbol} />
                  ) : (
                    <div className="mfp-detail-logo mfp-detail-logo--fallback">{deal.symbol?.charAt(0) || '?'}</div>
                  )}
                </div>
                <div className="mfp-detail-identity">
                  <div className="mfp-detail-name-row">
                    <span className="mfp-detail-symbol">{deal.symbol}</span>
                    <span className="mfp-detail-name">{deal.name}</span>
                    <span className="mfp-detail-stage-badge" style={{ color: stage?.color, background: `${stage?.color}12`, borderColor: `${stage?.color}25` }}>
                      {stage?.label}
                    </span>
                  </div>
                  <div className="mfp-detail-meta">
                    <span className="mfp-detail-category">{deal.category}</span>
                    <span className="mfp-detail-chain">{deal.chain}</span>
                    <span className="mfp-detail-risk" style={{ color: deal.riskColor }}>{deal.risk}</span>
                  </div>
                </div>
              </div>

              {/* Separator */}
              <div className="mfp-detail-sep" />

              {/* Thesis */}
              <p className="mfp-detail-thesis">{deal.thesis}</p>

              {/* Metrics */}
              <div className="mfp-detail-metrics">
                <div className="mfp-detail-metric">
                  <span className="mfp-detail-metric-label">Market Cap</span>
                  <span className="mfp-detail-metric-value">{deal.mcap}</span>
                </div>
                <div className="mfp-detail-metric">
                  <span className="mfp-detail-metric-label">24h Volume</span>
                  <span className="mfp-detail-metric-value">{deal.volume24h}</span>
                </div>
                <div className="mfp-detail-metric">
                  <span className="mfp-detail-metric-label">Holders</span>
                  <span className="mfp-detail-metric-value">{deal.holders}</span>
                </div>
                <div className="mfp-detail-metric">
                  <span className="mfp-detail-metric-label">24h Change</span>
                  <span className={`mfp-detail-metric-value ${deal.change24h >= 0 ? 'is-bull' : 'is-bear'}`}>
                    {deal.change24h >= 0 ? '+' : ''}{deal.change24h}%
                  </span>
                </div>
                <div className="mfp-detail-metric">
                  <span className="mfp-detail-metric-label">Holder Velocity</span>
                  <span className={`mfp-detail-metric-value ${deal.holderVelocity?.startsWith('+') ? 'is-bull' : 'is-bear'}`}>{deal.holderVelocity || '-'}</span>
                </div>
                <div className="mfp-detail-metric">
                  <span className="mfp-detail-metric-label">Top Holder</span>
                  <span className="mfp-detail-metric-value">{deal.topHolderPct || '-'}</span>
                </div>
              </div>

              {/* Separator */}
              <div className="mfp-detail-sep" />

              {/* Safety section */}
              <div className="mfp-detail-section">
                <h4 className="mfp-detail-section-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Safety Check
                </h4>
                <div className="mfp-detail-safety-grid">
                  <div className={`mfp-detail-safety-item ${deal.lpLocked ? 'is-safe' : 'is-danger'}`}>
                    <span className="mfp-detail-safety-label">LP Status</span>
                    <span className="mfp-detail-safety-value">{deal.lpLocked ? `Locked ${deal.lpPct || ''}`.trim() : 'Unlocked - Caution'}</span>
                  </div>
                  <div className={`mfp-detail-safety-item ${deal.deployerSafe ? 'is-safe' : 'is-danger'}`}>
                    <span className="mfp-detail-safety-label">Deployer</span>
                    <span className="mfp-detail-safety-value">{deal.deployer || '-'}</span>
                  </div>
                  <div className="mfp-detail-safety-item">
                    <span className="mfp-detail-safety-label">Social Velocity</span>
                    <span className="mfp-detail-safety-value">{deal.socialMentions || '-'}{deal.socialTrend ? ` (${deal.socialTrend})` : ''}</span>
                  </div>
                </div>
              </div>

              {/* Signal */}
              <div className="mfp-detail-section">
                <h4 className="mfp-detail-section-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Signal
                </h4>
                <p className="mfp-detail-signal-text">{deal.signal}</p>
              </div>

              {/* Socials */}
              {deal.socials && (
                <div className="mfp-detail-socials">
                  {Object.entries(deal.socials).map(([key, url]) => {
                    const icon = SOCIAL_ICONS[key]
                    if (!icon) return null
                    return (
                      <a key={key} className="mfp-detail-social" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
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
        )
      })(), document.body)}
    </div>
  )
}

export default MemeFlowPipeline
