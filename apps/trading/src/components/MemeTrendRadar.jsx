/**
 * MemeTrendRadar - "The Trend Radar"
 * Meme category rotation across narrative themes:
 *   Animal, Political, AI/Tech, Culture, Degen/Meta
 *
 * Tracks which meme categories are accumulating,
 * trending, or fading. Same glass card design
 * as SectorRotationMap but adapted for meme themes.
 */
import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { getTokenLogo } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './MemeTrendRadar.css'

/* ── Meme category phases ── */
const PHASES = [
  { id: 'rising', label: 'Rising', color: '#10B981', desc: 'Gaining mindshare, early momentum' },
  { id: 'viral', label: 'Viral', color: '#34D399', desc: 'Peak attention, maximum velocity' },
  { id: 'cooling', label: 'Cooling', color: '#FBBF24', desc: 'Attention declining, late entries' },
  { id: 'dormant', label: 'Dormant', color: '#EF4444', desc: 'Low activity, waiting for catalyst' },
]

const PHASE_TIPS = {
  'Rising': 'Category is gaining social velocity. Smart money positioning early.',
  'Viral': 'Peak attention and volume. Maximum social mentions per hour.',
  'Cooling': 'Attention declining from peak. Late entries getting trapped.',
  'Dormant': 'Minimal social activity. Category needs a fresh catalyst to reignite.',
}

const COL_TIPS = {
  'Category': 'Meme narrative theme grouping similar tokens.',
  'Phase': 'Current attention cycle stage for this meme category.',
  'Social Velocity': 'Mentions per hour across X, Telegram, Discord.',
  'Volume': '7-day total trading volume across tokens in category.',
  'Momentum': 'Trend strength score from 0-100.',
  'Signal': 'AI-generated intelligence on category positioning.',
}

/* ── Column headers ── */
const COLUMNS = [
  { label: 'Category', desc: 'Theme' },
  { label: 'Phase', desc: 'Cycle stage' },
  { label: 'Social Velocity', desc: 'Mentions/hr' },
  { label: 'Volume', desc: '7d total' },
  { label: 'Momentum', desc: 'Strength' },
  { label: 'Signal', desc: 'Intelligence' },
]

/* ── Category icons ── */
const CATEGORY_ICONS = {
  animal: 'M12 2c1.1 0 2 .9 2 2 0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7v1H3v-1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73 0-1.1.9-2 2-2z',
  political: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3',
  ai: 'M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V8h5a2 2 0 012 2v3.27c.6.34 1 .99 1 1.73a2 2 0 01-4 0c0-.74.4-1.39 1-1.73V10h-5v1.27c.6.34 1 .99 1 1.73a2 2 0 01-4 0c0-.74.4-1.39 1-1.73V10H6v3.27c.6.34 1 .99 1 1.73a2 2 0 01-4 0c0-.74.4-1.39 1-1.73V10a2 2 0 012-2h5V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zM8 20v2M16 20v2M12 20v2',
  culture: 'M12 2L2 19h20L12 2zM12 8v4M12 16h.01',
  degen: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-4-8c.79 0 1.5-.71 1.5-1.5S8.79 9 8 9s-1.5.71-1.5 1.5S7.21 12 8 12zm8-2c.79 0 1.5-.71 1.5-1.5S16.79 7 16 7s-1.5.71-1.5 1.5S15.21 10 16 10zm-4 8c2.21 0 4-1.79 4-4h-8c0 2.21 1.79 4 4 4z',
}

const CATEGORY_COLORS = {
  animal: '#F59E0B',
  political: '#EF4444',
  ai: '#8B5CF6',
  culture: '#06B6D4',
  degen: '#EC4899',
}

/* ── Social icon SVG paths ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', fill: false, paths: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a15.3 15.3 0 014 9 15.3 15.3 0 01-4 9 15.3 15.3 0 01-4-9 15.3 15.3 0 014-9z'] },
  x: { viewBox: '0 0 24 24', fill: true, paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'] },
  telegram: { viewBox: '0 0 24 24', fill: true, paths: ['M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'] },
  discord: { viewBox: '0 0 24 24', fill: true, paths: ['M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z'] },
}

/* ── Token navigation data ── */
const TOKEN_NAV_DATA = {
  DOGE: { address: 'DOGE', networkId: 0, name: 'Dogecoin' },
  PEPE: { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', networkId: 1, name: 'Pepe' },
  WIF: { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', networkId: 1399811149, name: 'dogwifhat' },
  BONK: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', networkId: 1399811149, name: 'Bonk' },
  SHIB: { address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', networkId: 1, name: 'Shiba Inu' },
  FLOKI: { address: '0xcf0C122c3b20174e85b19F966CEf9e6b3C0f3B84', networkId: 1, name: 'Floki Inu' },
  POPCAT: { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', networkId: 1399811149, name: 'Popcat' },
  MEW: { address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', networkId: 1399811149, name: 'cat in a dogs world' },
  MYRO: { address: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4', networkId: 1399811149, name: 'Myro' },
}

/* ── Meme category rotation data (static fallback) ── */
const TREND_DATA = [
  {
    id: 'animal',
    label: 'Animal Memes',
    phase: 'viral',
    socialVelocity: 4200,
    velocityChange: 34.2,
    volume7d: '$8.4B',
    momentum: 86,
    topMover: 'POPCAT +42%',
    signal: 'Cat meta reigniting after dog fatigue. MEW and POPCAT leading rotation from legacy animal memes.',
    extended: {
      totalMcap: '$42B',
      volume7d: '$8.4B',
      activeTokens: 120,
      avgHolderGrowth: '+12% / week',
      insight: 'Animal memes remain the dominant meme category by market cap. The current wave is driven by cat tokens rotating from dog fatigue. POPCAT and MEW are leading with genuine viral moments. Legacy plays like DOGE and SHIB have become more "store of value" than meme - the action is in mid-caps.',
      keyTokens: [
        { symbol: 'POPCAT', change: '+42%', role: 'Rising cat meme with internet culture backing', socials: { website: 'https://popcatsolana.com', x: 'https://x.com/Popcatsolana', telegram: 'https://telegram.me/popcatsolana' } },
        { symbol: 'MEW', change: '+28%', role: 'Cat challenger to WIF dominance', socials: { x: 'https://x.com/MewsWorld', telegram: 'https://telegram.me/MewsWorld' } },
        { symbol: 'WIF', change: '+8%', role: 'Solana dog meme blue chip', socials: { website: 'https://dogwifcoin.org', x: 'https://x.com/dogwifcoin' } },
        { symbol: 'BONK', change: '+5%', role: 'Solana community dog with utility', socials: { website: 'https://bonkcoin.com', x: 'https://x.com/bonk_inu', discord: 'https://discord.gg/bonk' } },
      ],
      catalysts: [
        'Cat meme meta is self-reinforcing through viral content',
        'Solana speed enables rapid meme token launches and trading',
        'CEX listings for cat tokens creating new demand',
      ],
      risks: [
        'Animal meme meta can shift overnight to new theme',
        'High number of low-quality imitators diluting attention',
        'Legacy animal tokens (DOGE, SHIB) anchoring while new plays run',
      ],
    },
  },
  {
    id: 'political',
    label: 'Political Memes',
    phase: 'cooling',
    socialVelocity: 1800,
    velocityChange: -22.5,
    volume7d: '$2.1B',
    momentum: 42,
    topMover: 'TRUMP -18%',
    signal: 'Election cycle attention fading between news events. Volume dropping but spikes violently on headlines.',
    extended: {
      totalMcap: '$3.8B',
      volume7d: '$2.1B',
      activeTokens: 45,
      avgHolderGrowth: '-4% / week',
      insight: 'Political memes are highly event-driven with extreme volatility around news cycles. Between events, attention and volume collapse. TRUMP dominates the category but has severe whale concentration. The category will reignite during election season but timing entries is critical.',
      keyTokens: [
        { symbol: 'TRUMP', change: '-18%', role: 'Dominant political meme, event-driven', socials: { x: 'https://x.com/MAGAMemecoin' } },
        { symbol: 'DOGE', change: '-3%', role: 'Elon/political crossover narrative', socials: { website: 'https://dogecoin.com', x: 'https://x.com/dogecoin' } },
      ],
      catalysts: [
        'Upcoming election debates driving sudden volume spikes',
        'Political endorsement of crypto creating crossover audience',
        'Regulatory clarity on political tokens could legitimize sector',
      ],
      risks: [
        'Severe whale concentration - insider dump risk on TRUMP',
        'Regulatory scrutiny specifically targeting political tokens',
        'Binary event risk - wrong side of news cycle causes -50%+ crashes',
      ],
    },
  },
  {
    id: 'ai',
    label: 'AI / Tech Memes',
    phase: 'rising',
    socialVelocity: 2400,
    velocityChange: 18.6,
    volume7d: '$1.8B',
    momentum: 72,
    topMover: 'GOAT +35%',
    signal: 'AI agent narrative crossing into meme territory. GOAT pioneered the AI-meme category. Fresh theme with room.',
    extended: {
      totalMcap: '$2.2B',
      volume7d: '$1.8B',
      activeTokens: 60,
      avgHolderGrowth: '+8% / week',
      insight: 'AI memes are the newest and fastest-growing category. GOAT (created by an AI agent) proved that AI-generated tokens can achieve legitimate market caps. The theme has narrative tailwinds from mainstream AI hype. Watch for more AI agent launches creating tokens autonomously - this is a genuinely novel primitive.',
      keyTokens: [
        { symbol: 'GOAT', change: '+35%', role: 'First AI agent-created memecoin', socials: { x: 'https://x.com/goaborrowt_ai' } },
        { symbol: 'TURBO', change: '+22%', role: 'GPT-designed token experiment', socials: { x: 'https://x.com/TurboToadToken', telegram: 'https://telegram.me/TurboToadToken' } },
      ],
      catalysts: [
        'More AI agents launching tokens - creating a meta narrative',
        'OpenAI and tech headlines driving crossover attention',
        'Novelty factor - AI memes feel genuinely new vs recycled themes',
      ],
      risks: [
        'Most AI memes have zero technical substance - pure narrative',
        'AI hype bubble risk if NVIDIA or OpenAI disappoints',
        'Low liquidity on most AI meme tokens - high slippage',
      ],
    },
  },
  {
    id: 'culture',
    label: 'Culture Memes',
    phase: 'viral',
    socialVelocity: 3600,
    velocityChange: 28.4,
    volume7d: '$5.2B',
    momentum: 78,
    topMover: 'PEPE +16%',
    signal: 'Pepe remains the cultural backbone. New formats emerging around internet culture moments.',
    extended: {
      totalMcap: '$12B',
      volume7d: '$5.2B',
      activeTokens: 80,
      avgHolderGrowth: '+6% / week',
      insight: 'Culture memes draw from internet culture and have the widest cultural moat. PEPE is the clear leader - the Pepe meme transcends crypto and has genuine cultural staying power. New culture memes emerge from viral moments but PEPE acts as the blue chip. Category tends to move with broader meme sentiment.',
      keyTokens: [
        { symbol: 'PEPE', change: '+16%', role: 'Ethereum OG culture meme', socials: { website: 'https://pepecoin.io', x: 'https://x.com/pepecoineth', telegram: 'https://telegram.me/pepecoineth' } },
        { symbol: 'FLOKI', change: '+9%', role: 'Viking meme with utility pivot', socials: { website: 'https://floki.com', x: 'https://x.com/RealFlokiInu', telegram: 'https://telegram.me/FlokiInuToken' } },
      ],
      catalysts: [
        'Viral internet moments creating new meme token opportunities',
        'PEPE ecosystem development (L2 rumors, DeFi integration)',
        'Cultural events (meme festivals, influencer endorsements)',
      ],
      risks: [
        'Culture is fickle - what is viral today is forgotten tomorrow',
        'Ethereum gas costs limit retail entry during high volatility',
        'Meme fatigue if broader crypto market turns bearish',
      ],
    },
  },
  {
    id: 'degen',
    label: 'Degen / Meta',
    phase: 'dormant',
    socialVelocity: 800,
    velocityChange: -41.2,
    volume7d: '$420M',
    momentum: 18,
    topMover: 'MYRO -28%',
    signal: 'Pure degen plays exhausted. Smart money rotated out. Wait for capitulation before re-entry.',
    extended: {
      totalMcap: '$680M',
      volume7d: '$420M',
      activeTokens: 200,
      avgHolderGrowth: '-12% / week',
      insight: 'Degen/meta memes are the highest-risk category - tokens launched specifically to ride the meme meta with no underlying theme. These tokens live and die on CT attention. Currently in deep dormancy after the last wave exhausted retail. Historically, this category recovers last and recovers the hardest when it does.',
      keyTokens: [
        { symbol: 'MYRO', change: '-28%', role: 'Dog meta-meme, pure degen play', socials: { x: 'https://x.com/MyroSOL', telegram: 'https://telegram.me/myrosol' } },
      ],
      catalysts: [
        'New meme season could lift all boats including degen plays',
        'Novel launch mechanism (AI agents, fair launches) creating hype',
        'CT influencer rotations back into degen sector',
      ],
      risks: [
        'Most degen tokens go to zero - 95%+ rug rate',
        'No fundamental floor - purely attention-driven',
        'Extreme whale concentration across all degen plays',
      ],
    },
  },
]

function MemeTrendRadar({ trends, activeSymbol, selectToken }) {
  const [selectedPhase, setSelectedPhase] = useState(null)
  const [visibleRows, setVisibleRows] = useState(new Set())
  const [selectedCategory, setSelectedCategory] = useState(null)
  const rowRefs = useRef({})

  // Use dynamic trends when present, else fall back to the static set
  const trendData = Array.isArray(trends) && trends.length ? trends : TREND_DATA

  // Escape key + body scroll lock
  useEffect(() => {
    if (!selectedCategory) return
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarW}px`
    const onKey = (e) => { if (e.key === 'Escape') setSelectedCategory(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [selectedCategory])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setVisibleRows(prev => new Set([...prev, entry.target.dataset.category]))
          }
        })
      },
      { threshold: 0.1 }
    )
    Object.values(rowRefs.current).forEach(el => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [selectedPhase])

  const filtered = selectedPhase
    ? trendData.filter(d => d.phase === selectedPhase)
    : [...trendData].sort((a, b) => (b.momentum || 0) - (a.momentum || 0))

  return (
    <div className="mtr">
      {/* Phase legend / filter */}
      <div className="mtr-phases">
        <button
          className={`mtr-phase-btn ${selectedPhase === null ? 'is-active' : ''}`}
          onClick={() => setSelectedPhase(null)}
        >
          All Phases
        </button>
        {PHASES.map(phase => (
          <button
            key={phase.id}
            className={`mtr-phase-btn ${selectedPhase === phase.id ? 'is-active' : ''}`}
            onClick={() => setSelectedPhase(selectedPhase === phase.id ? null : phase.id)}
          >
            <span className="mtr-phase-dot" style={{ background: phase.color, boxShadow: `0 0 6px ${phase.color}40` }} />
            {phase.label}<InfoTip text={PHASE_TIPS[phase.label]} position="bottom" />
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="mtr-col-headers">
        {COLUMNS.map((col, i) => (
          <div key={i} className="mtr-col-header">
            <span className="mtr-col-header-label">{col.label}{COL_TIPS[col.label] && <InfoTip text={COL_TIPS[col.label]} position="bottom" />}</span>
            <span className="mtr-col-header-desc">{col.desc}</span>
          </div>
        ))}
      </div>

      {/* Trend rows */}
      <div className="mtr-list">
        {filtered.map((item, i) => {
          const phase = PHASES.find(p => p.id === item.phase)
          const iconPath = CATEGORY_ICONS[item.id]
          const catColor = CATEGORY_COLORS[item.id] || '#fff'
          const isVisible = visibleRows.has(item.id)
          const velocityBar = Math.min((item.socialVelocity || 0) / 50, 100)
          const isBull = (item.velocityChange || 0) >= 0

          return (
            <div
              key={item.id}
              className={`mtr-row ${isVisible ? 'is-visible' : ''}`}
              data-category={item.id}
              ref={el => rowRefs.current[item.id] = el}
              style={{ transitionDelay: `${i * 60}ms` }}
              onClick={() => setSelectedCategory(item)}
            >
              <div className="mtr-row-accent" style={{ background: `linear-gradient(90deg, transparent, ${phase?.color || '#fff'}30, transparent)` }} />

              {/* Category identity */}
              <div className="mtr-row-category">
                <div className="mtr-row-icon-wrap" style={{ borderColor: `${catColor}20` }}>
                  <svg className="mtr-row-icon" viewBox="0 0 24 24" fill="none" stroke={catColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={iconPath} />
                  </svg>
                </div>
                <div className="mtr-row-category-info">
                  <span className="mtr-row-category-name">{item.label}</span>
                  <span className="mtr-row-top-mover">{item.topMover}</span>
                </div>
              </div>

              {/* Phase badge */}
              <div className="mtr-row-phase">
                <span className="mtr-row-phase-dot" style={{ background: phase?.color, boxShadow: `0 0 6px ${phase?.color}40` }} />
                <span className="mtr-row-phase-label">{phase?.label}</span>
              </div>

              {/* Social velocity */}
              <div className="mtr-row-velocity">
                <div className="mtr-velocity-bar-track">
                  <div
                    className="mtr-velocity-bar-fill"
                    style={{
                      width: isVisible ? `${velocityBar}%` : '0%',
                      background: `linear-gradient(90deg, ${catColor}40, ${catColor})`,
                      boxShadow: isVisible ? `0 0 6px ${catColor}20` : 'none',
                      transitionDelay: `${i * 60 + 200}ms`,
                    }}
                  />
                </div>
                <span className={`mtr-velocity-value ${isBull ? 'is-bull' : 'is-bear'}`}>
                  {isBull ? '+' : ''}{item.velocityChange}%
                </span>
              </div>

              {/* Volume */}
              <span className="mtr-row-volume">{item.volume7d}</span>

              {/* Momentum gauge */}
              <div className="mtr-row-momentum">
                <div className="mtr-momentum-track">
                  <div
                    className="mtr-momentum-fill"
                    style={{
                      width: isVisible ? `${item.momentum}%` : '0%',
                      background: `linear-gradient(90deg, ${item.momentum > 60 ? '#10B98150' : item.momentum > 40 ? '#FBBF2450' : '#EF444450'}, ${item.momentum > 60 ? '#10B981' : item.momentum > 40 ? '#FBBF24' : '#EF4444'})`,
                      boxShadow: isVisible ? `0 0 6px ${item.momentum > 60 ? '#10B98120' : item.momentum > 40 ? '#FBBF2420' : '#EF444420'}` : 'none',
                      transitionDelay: `${i * 60 + 300}ms`,
                    }}
                  />
                </div>
                <span className="mtr-momentum-value">{item.momentum}</span>
              </div>

              {/* Signal */}
              <div className="mtr-row-signal">
                <svg className="mtr-row-signal-icon" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="mtr-row-signal-text">{item.signal}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Detail Popup ── */}
      {selectedCategory && createPortal((() => {
        const item = selectedCategory
        const ext = item.extended || {}
        const phase = PHASES.find(p => p.id === item.phase)
        const iconPath = CATEGORY_ICONS[item.id]
        const catColor = CATEGORY_COLORS[item.id] || '#fff'
        const isBull = (item.velocityChange || 0) >= 0

        return (
          <div className="mtr-detail-overlay" onClick={() => setSelectedCategory(null)}>
            <div className="mtr-detail" onClick={e => e.stopPropagation()}>
              <div className="mtr-detail-accent" style={{ background: `linear-gradient(90deg, transparent, ${phase?.color || '#fff'}40, transparent)` }} />
              <div className="mtr-detail-edge-hl" />

              <button className="mtr-detail-close" onClick={() => setSelectedCategory(null)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 1l12 12M13 1L1 13" />
                </svg>
              </button>

              {/* Header */}
              <div className="mtr-detail-header">
                <div className="mtr-detail-icon-wrap" style={{ borderColor: `${catColor}20` }}>
                  <svg className="mtr-detail-icon" viewBox="0 0 24 24" fill="none" stroke={catColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={iconPath} />
                  </svg>
                </div>
                <div className="mtr-detail-identity">
                  <div className="mtr-detail-name-row">
                    <span className="mtr-detail-name">{item.label}</span>
                    <span className="mtr-detail-phase-badge" style={{ color: phase?.color, background: `${phase?.color}15`, borderColor: `${phase?.color}20` }}>
                      <span className="mtr-detail-phase-dot" style={{ background: phase?.color, boxShadow: `0 0 6px ${phase?.color}40` }} />
                      {phase?.label}
                    </span>
                  </div>
                  <div className="mtr-detail-meta">
                    <span className={`mtr-detail-velocity ${isBull ? 'is-bull' : 'is-bear'}`}>
                      {isBull ? '+' : ''}{item.velocityChange}% velocity
                    </span>
                    <span className="mtr-detail-mentions">{(item.socialVelocity || 0).toLocaleString()} mentions/hr</span>
                    <span className="mtr-detail-top-mover">{item.topMover || '-'}</span>
                  </div>
                </div>
              </div>

              <div className="mtr-detail-sep" />

              {/* Metrics */}
              <div className="mtr-detail-metrics">
                <div className="mtr-detail-metric">
                  <span className="mtr-detail-metric-label">Total MCap</span>
                  <span className="mtr-detail-metric-value">{ext.totalMcap}</span>
                </div>
                <div className="mtr-detail-metric">
                  <span className="mtr-detail-metric-label">7D Volume</span>
                  <span className="mtr-detail-metric-value">{ext.volume7d}</span>
                </div>
                <div className="mtr-detail-metric">
                  <span className="mtr-detail-metric-label">Active Tokens</span>
                  <span className="mtr-detail-metric-value">{ext.activeTokens}</span>
                </div>
                <div className="mtr-detail-metric">
                  <span className="mtr-detail-metric-label">Holder Growth</span>
                  <span className="mtr-detail-metric-value">{ext.avgHolderGrowth}</span>
                </div>
              </div>

              <div className="mtr-detail-sep" />

              {/* Two-column body */}
              <div className="mtr-detail-body">
                <div className="mtr-detail-body-left">
                  <div className="mtr-detail-section">
                    <h4 className="mtr-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                      Top Tokens
                    </h4>
                    <div className="mtr-detail-tokens">
                      {(ext.keyTokens || []).map((t, ti) => {
                        const logo = getTokenLogo(t.symbol)
                        const nav = TOKEN_NAV_DATA[t.symbol]
                        return (
                          <div key={ti} className="mtr-detail-token-row">
                            <div
                              className={`mtr-detail-token-content${nav ? ' is-clickable' : ''}`}
                              onClick={() => {
                                if (nav && selectToken) {
                                  selectToken({ symbol: t.symbol, name: nav.name, address: nav.address, networkId: nav.networkId, logo: getTokenLogo(t.symbol) })
                                  setSelectedCategory(null)
                                }
                              }}
                            >
                              <div className="mtr-detail-token-info">
                                {logo ? (
                                  <img className="mtr-detail-token-logo" src={logo} alt={t.symbol} />
                                ) : (
                                  <div className="mtr-detail-token-logo mtr-detail-token-logo--fallback">{t.symbol?.charAt(0) || '?'}</div>
                                )}
                                <span className="mtr-detail-token-symbol">{t.symbol}</span>
                                {t.change != null && (
                                  <span className={`mtr-detail-token-change ${String(t.change).startsWith('+') ? 'is-bull' : 'is-bear'}`}>{t.change}</span>
                                )}
                              </div>
                              <span className="mtr-detail-token-role">{t.role}</span>
                            </div>
                            {t.socials && (
                              <div className="mtr-detail-token-socials">
                                {Object.entries(t.socials).map(([key, url]) => {
                                  const icon = SOCIAL_ICONS[key]
                                  if (!icon) return null
                                  return (
                                    <a key={key} className="mtr-detail-token-social" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                      <svg viewBox={icon.viewBox} {...(icon.fill ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' })}>
                                        {icon.paths.map((d, pi) => <path key={pi} d={d} />)}
                                      </svg>
                                    </a>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Momentum + Velocity gauges */}
                  <div className="mtr-detail-gauges">
                    <div className="mtr-detail-gauge">
                      <span className="mtr-detail-gauge-label">Momentum</span>
                      <div className="mtr-detail-gauge-track">
                        <div
                          className="mtr-detail-gauge-fill"
                          style={{
                            width: `${item.momentum}%`,
                            background: `linear-gradient(90deg, ${item.momentum > 60 ? '#10B98150' : item.momentum > 40 ? '#FBBF2450' : '#EF444450'}, ${item.momentum > 60 ? '#10B981' : item.momentum > 40 ? '#FBBF24' : '#EF4444'})`,
                          }}
                        />
                      </div>
                      <span className="mtr-detail-gauge-value">{item.momentum}</span>
                    </div>
                    <div className="mtr-detail-gauge">
                      <span className="mtr-detail-gauge-label">Velocity</span>
                      <div className="mtr-detail-gauge-track">
                        <div
                          className={`mtr-detail-gauge-fill ${isBull ? 'is-bull' : 'is-bear'}`}
                          style={{ width: `${Math.min(Math.abs(item.velocityChange) * 2, 100)}%` }}
                        />
                      </div>
                      <span className={`mtr-detail-gauge-value ${isBull ? 'is-bull' : 'is-bear'}`}>
                        {isBull ? '+' : ''}{item.velocityChange}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mtr-detail-body-right">
                  <div className="mtr-detail-section">
                    <h4 className="mtr-detail-section-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Category Analysis
                    </h4>
                    <p className="mtr-detail-insight">{ext.insight}</p>
                  </div>

                  {ext.catalysts && (
                    <div className="mtr-detail-section">
                      <h4 className="mtr-detail-section-title mtr-detail-section-title--bull">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        Catalysts
                      </h4>
                      <ul className="mtr-detail-list mtr-detail-list--bull">
                        {ext.catalysts.map((c, ci) => <li key={ci}>{c}</li>)}
                      </ul>
                    </div>
                  )}

                  {ext.risks && (
                    <div className="mtr-detail-section">
                      <h4 className="mtr-detail-section-title mtr-detail-section-title--bear">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                        </svg>
                        Risk Factors
                      </h4>
                      <ul className="mtr-detail-list mtr-detail-list--bear">
                        {ext.risks.map((r, ri) => <li key={ri}>{r}</li>)}
                      </ul>
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

export default MemeTrendRadar
