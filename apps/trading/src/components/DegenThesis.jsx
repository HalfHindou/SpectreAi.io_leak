/**
 * DegenThesis - "Alpha Thesis"
 * Meme-adapted alpha thesis cards:
 *   Viral catalysts, community conviction, rug risk,
 *   whale activity, comparable memes.
 *
 * Glass card design with conviction-colored accents,
 * animated rug risk pips, and cinematic blur-in entrance.
 * Follows AlphaThesisCards pattern with meme-specific fields.
 */
import React, { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTokenLogo } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './DegenThesis.css'

/* ── Social icon SVG paths ── */
const SOCIAL_ICONS = {
  website: { viewBox: '0 0 24 24', paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z'], fill: true },
  x: { viewBox: '0 0 24 24', paths: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'], fill: true },
  discord: { viewBox: '0 0 24 24', paths: ['M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z'], fill: true },
  telegram: { viewBox: '0 0 24 24', paths: ['M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'], fill: true },
}

/* Conviction color map */
const CONVICTION_COLOR = {
  high: '#10B981',
  medium: '#FBBF24',
  low: 'rgba(255,255,255,0.3)',
}

/* ── Alpha thesis data (static fallback) ── */
const THESES = [
  {
    id: 'dt1',
    symbol: 'WIF',
    name: 'dogwifhat',
    category: 'Animal',
    comparable: 'The Solana DOGE - community-first dog meme with cultural momentum',
    rugRisk: 2,
    viralPotential: 'High',
    conviction: 'High',
    mcap: '$2.8B', holders: '185K', volume24h: '$320M', chain: 'Solana',
    topWhale: '3.8%', lpLocked: '92%',
    analystNote: 'WIF is the Solana meme blue chip. Clean deployer history, mint authority revoked, strong community. The Las Vegas Sphere stunt created a cultural moment that cemented WIF as the "serious" Solana meme. Risk is approaching peak mindshare - watch for smart money exits.',
    viralCatalysts: [
      'Community-funded marketing stunts (billboards, events)',
      'Solana ecosystem growth lifting all meme boats',
      'Cat-to-dog meta rotation when cat fatigue sets in',
    ],
    rugFactors: [
      'LP partially unlocked - 8% remains unlockable',
      'New Solana memes cannibalizing attention share',
      'Approaching late-cycle for this meme wave',
    ],
    whaleActivity: 'Stable - top wallets holding. No large sell-offs detected in last 14 days. Accumulation pattern from 3 new wallets >$500K.',
    comparables: [
      { symbol: 'BONK', mcap: '$2.1B', metric: 'Solana OG meme' },
      { symbol: 'DOGE', mcap: '$22B', metric: 'Dog meme standard' },
      { symbol: 'SHIB', mcap: '$8.6B', metric: 'ETH dog meme' },
    ],
    socials: { website: 'https://dogwifcoin.org', x: 'https://x.com/dogwifcoin', telegram: 'https://telegram.me/dogwifcoin' },
  },
  {
    id: 'dt2',
    symbol: 'PEPE',
    name: 'Pepe',
    category: 'Culture',
    comparable: 'The BTC of memes - cultural moat no other meme can replicate',
    rugRisk: 1,
    viralPotential: 'Medium',
    conviction: 'High',
    mcap: '$4.2B', holders: '280K', volume24h: '$420M', chain: 'Ethereum',
    topWhale: '5.2%', lpLocked: '100% (burned)',
    analystNote: 'PEPE is the safest meme bet. Contract renounced, LP burned, no owner functions. The Pepe meme transcends crypto - it has a cultural moat that no other meme token can replicate. The risk is Ethereum gas costs limiting retail access during volatility spikes.',
    viralCatalysts: [
      'Pepe L2 chain rumors would add DeFi utility layer',
      'Cultural moment viral events (unpredictable but recurring)',
      'CEX listing catalysts on remaining tier 1 exchanges',
    ],
    rugFactors: [
      'Ethereum gas costs limit retail participation in spikes',
      'Distribution phase - smart money reducing from ATH positions',
      'No utility roadmap - pure meme status has ceiling',
    ],
    whaleActivity: 'Distribution pattern - top 10 wallets reduced exposure by 12% over 30 days. New retail inflows offsetting. Net holder count still increasing.',
    comparables: [
      { symbol: 'DOGE', mcap: '$22B', metric: 'OG meme standard' },
      { symbol: 'SHIB', mcap: '$8.6B', metric: 'ETH meme peer' },
      { symbol: 'FLOKI', mcap: '$1.8B', metric: 'Utility pivot meme' },
    ],
    socials: { website: 'https://pepecoin.io', x: 'https://x.com/pepecoineth', telegram: 'https://telegram.me/pepecoineth' },
  },
  {
    id: 'dt3',
    symbol: 'BONK',
    name: 'Bonk',
    category: 'Animal',
    comparable: 'The community-owned Solana meme with real utility via BonkBot',
    rugRisk: 2,
    viralPotential: 'Medium',
    conviction: 'Medium',
    mcap: '$2.1B', holders: '820K', volume24h: '$180M', chain: 'Solana',
    topWhale: '2.4%', lpLocked: '100% (DAO)',
    analystNote: 'BONK has the best distribution of any meme token - airdropped to the Solana community with no insider allocation. BonkBot drives real utility and trading volume. The DAO structure is a double-edged sword: genuine decentralization but slow governance. Best risk/reward in the Solana meme space.',
    viralCatalysts: [
      'BonkBot expanding to more chains and DEX aggregation',
      'Bonk DAO treasury deploying capital for ecosystem grants',
      'Token burn schedule creating deflationary pressure',
    ],
    rugFactors: [
      'Utility narrative may not sustain in a pure meme downturn',
      'DAO governance can be slow during fast-moving meme cycles',
      'Competition from new Solana meme trading bots',
    ],
    whaleActivity: 'Accumulation - DAO treasury growing. No whale concentration risk. Largest wallet is the DAO multisig at 2.4%. Holder count growing +8% month over month.',
    comparables: [
      { symbol: 'WIF', mcap: '$2.8B', metric: 'Solana meme peer' },
      { symbol: 'DOGE', mcap: '$22B', metric: 'Community meme' },
      { symbol: 'FLOKI', mcap: '$1.8B', metric: 'Utility pivot peer' },
    ],
    socials: { website: 'https://bonkcoin.com', x: 'https://x.com/bonk_inu', telegram: 'https://telegram.me/Official_Bonk', discord: 'https://discord.gg/bonk' },
  },
  {
    id: 'dt4',
    symbol: 'POPCAT',
    name: 'Popcat',
    category: 'Animal',
    comparable: 'The cat meme breakout - riding the cat meta rotation on Solana',
    rugRisk: 4,
    viralPotential: 'High',
    conviction: 'Medium',
    mcap: '$420M', holders: '18.2K', volume24h: '$34M', chain: 'Solana',
    topWhale: '8.2%', lpLocked: '92%',
    analystNote: 'POPCAT is the highest-beta play in the cat meme meta. Clean deployer, decent distribution for its age, and riding the cat narrative hard. The risk is thin liquidity - a $50K+ trade moves the price 1%+. This is a high-conviction trade if you believe the cat meta has legs, but size your position for the liquidity.',
    viralCatalysts: [
      'Cat meme meta sustaining through Q1 2026',
      'CEX listing catalysts - limited listings currently',
      'Cross-pollination with Popcat internet meme culture',
    ],
    rugFactors: [
      'Thin LP - vulnerable to whale dumps and high slippage',
      'Cat meme meta could be short-lived narrative cycle',
      'Competition from MEW and other cat tokens fragmenting attention',
    ],
    whaleActivity: 'Mixed signals - two large wallets accumulated $200K+ in past 7 days, but one early wallet sold 15% of position. Net flow slightly positive.',
    comparables: [
      { symbol: 'MEW', mcap: '$380M', metric: 'Cat meme rival' },
      { symbol: 'WIF', mcap: '$2.8B', metric: 'Animal meme target' },
      { symbol: 'MYRO', mcap: '$120M', metric: 'Small-cap SOL meme' },
    ],
    socials: { website: 'https://popcatsolana.com', x: 'https://x.com/Popcatsolana', telegram: 'https://telegram.me/popcatsolana' },
  },
]

function DegenThesis({ theses, activeSymbol, selectToken }) {
  const [visibleCards, setVisibleCards] = useState(new Set())
  const [modalThesis, setModalThesis] = useState(null)
  const cardRefs = useRef({})

  // Use dynamic theses when present, else fall back to the static set
  const thesisData = Array.isArray(theses) && theses.length ? theses : THESES

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
  }, [])

  useEffect(() => {
    if (!modalThesis) return
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarW}px`
    const onKey = (e) => { if (e.key === 'Escape') setModalThesis(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [modalThesis])

  const rugLabel = (score) => {
    if (score <= 2) return 'Low'
    if (score <= 4) return 'Moderate'
    if (score <= 6) return 'Elevated'
    return 'High'
  }

  const rugColor = (score) => {
    if (score <= 2) return '#10B981'
    if (score <= 4) return '#FBBF24'
    if (score <= 6) return '#F97316'
    return '#EF4444'
  }

  return (
    <div className="dth">
      <div className="dth-grid">
        {thesisData.map((thesis, i) => {
          const logo = getTokenLogo(thesis.symbol)
          const isVisible = visibleCards.has(thesis.id)
          const rColor = rugColor(thesis.rugRisk)
          const conviction = thesis.conviction || ''
          const convColor = CONVICTION_COLOR[conviction.toLowerCase()] || CONVICTION_COLOR.low

          return (
            <div
              key={thesis.id}
              className={`dth-card ${isVisible ? 'is-visible' : ''} ${activeSymbol && thesis.symbol === activeSymbol ? 'is-highlighted' : ''} ${activeSymbol && thesis.symbol !== activeSymbol ? 'is-dimmed' : ''}`}
              data-id={thesis.id}
              ref={el => cardRefs.current[thesis.id] = el}
              style={{ transitionDelay: `${i * 60}ms` }}
              onClick={() => setModalThesis(thesis)}
            >
              <div className="dth-card-accent" style={{ background: `linear-gradient(90deg, transparent, ${convColor}40, transparent)` }} />

              {/* Header */}
              <div className="dth-card-head">
                <div className="dth-card-token">
                  {logo ? (
                    <img className="dth-card-logo" src={logo} alt={thesis.symbol} />
                  ) : (
                    <div className="dth-card-logo dth-card-logo--fallback">{thesis.symbol?.charAt(0) || '?'}</div>
                  )}
                  <div className="dth-card-names">
                    <span className="dth-card-symbol">{thesis.symbol}</span>
                    <span className="dth-card-name">{thesis.name}</span>
                  </div>
                </div>
                <div className="dth-card-conviction" data-level={conviction.toLowerCase()}>
                  {thesis.conviction}<InfoTip text="Analyst confidence level in the meme thesis - High, Medium, or Low." position="left" />
                </div>
              </div>

              {/* Comparable */}
              <p className="dth-card-comparable">{thesis.comparable}</p>

              {/* Quick metrics */}
              <div className="dth-card-quick">
                <div className="dth-card-quick-item">
                  <span className="dth-card-quick-label">Rug Risk<InfoTip text="Risk of rug pull from 1 (safest) to 8 (most risky) based on LP lock, deployer history, and whale concentration." position="top" /></span>
                  <div className="dth-card-risk-bar">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                      <span
                        key={n}
                        className={`dth-risk-pip ${n <= thesis.rugRisk ? 'is-filled' : ''}`}
                        style={{
                          background: n <= thesis.rugRisk ? rColor : undefined,
                          boxShadow: n <= thesis.rugRisk ? `0 0 4px ${rColor}30` : 'none',
                        }}
                      />
                    ))}
                  </div>
                  <span className="dth-card-risk-label" style={{ color: rColor }}>{rugLabel(thesis.rugRisk)}</span>
                </div>
                <div className="dth-card-quick-item">
                  <span className="dth-card-quick-label">MCap</span>
                  <span className="dth-card-quick-value">{thesis.mcap}</span>
                </div>
                <div className="dth-card-quick-item">
                  <span className="dth-card-quick-label">Top Whale</span>
                  <span className="dth-card-quick-value">{thesis.topWhale}</span>
                </div>
              </div>

              {/* Viral / Rug cases */}
              <div className="dth-card-cases">
                <div className="dth-card-case dth-card-case--bull">
                  <span className="dth-card-case-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                    Viral Catalysts<InfoTip text="Factors that could drive viral price action upward." position="right" />
                  </span>
                  <ul className="dth-card-case-list">
                    {(thesis.viralCatalysts || []).map((point, j) => <li key={j}>{point}</li>)}
                  </ul>
                </div>
                <div className="dth-card-case dth-card-case--bear">
                  <span className="dth-card-case-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>
                    Rug Factors<InfoTip text="Risk factors that could cause the token to lose significant value." position="right" />
                  </span>
                  <ul className="dth-card-case-list">
                    {(thesis.rugFactors || []).map((point, j) => <li key={j}>{point}</li>)}
                  </ul>
                </div>
              </div>

              {/* Footer */}
              <div className="dth-card-footer">
                <span className="dth-card-category">{thesis.category}</span>
                <span className="dth-card-lp">LP: {thesis.lpLocked || '-'}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Detail Modal ── */}
      {modalThesis && createPortal(
        (() => {
          const t = modalThesis
          const logo = getTokenLogo(t.symbol)
          const rColor = rugColor(t.rugRisk)
          const tConviction = t.conviction || ''
          const convColor = CONVICTION_COLOR[tConviction.toLowerCase()] || CONVICTION_COLOR.low

          return (
            <div className="dth-overlay" onClick={() => setModalThesis(null)}>
              <div className="dth-modal" onClick={e => e.stopPropagation()}>
                <div className="dth-modal-glow" style={{ '--conv-color': convColor }} aria-hidden="true" />
                <div className="dth-modal-accent" style={{ background: `linear-gradient(90deg, transparent, ${convColor}55, transparent)` }} aria-hidden="true" />

                {/* Top: Identity + conviction + close */}
                <div className="dth-modal-top dth-modal-stagger" style={{ '--stagger': 0 }}>
                  <div className="dth-modal-token">
                    <div className="dth-modal-logo-wrap">
                      {logo ? (
                        <img className="dth-modal-logo" src={logo} alt={t.symbol} />
                      ) : (
                        <div className="dth-modal-logo dth-modal-logo--fallback">{t.symbol?.charAt(0) || '?'}</div>
                      )}
                    </div>
                    <div className="dth-modal-names">
                      <div className="dth-modal-names-row">
                        <span className="dth-modal-symbol">{t.symbol}</span>
                        <span className="dth-modal-mcap">{t.mcap}</span>
                      </div>
                      <span className="dth-modal-name">{t.name}</span>
                    </div>
                  </div>
                  <div className="dth-modal-top-right">
                    <div className="dth-modal-conv-badge" data-level={tConviction.toLowerCase()}>
                      {t.conviction} Conviction
                    </div>
                    <button className="dth-modal-close" onClick={() => setModalThesis(null)} aria-label="Close">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Comparable */}
                <p className="dth-modal-comparable dth-modal-stagger" style={{ '--stagger': 1 }}>"{t.comparable}"</p>

                {/* Metrics grid */}
                <div className="dth-modal-metrics dth-modal-stagger" style={{ '--stagger': 2 }}>
                  <div className="dth-modal-metric">
                    <span className="dth-modal-metric-label">Market Cap</span>
                    <span className="dth-modal-metric-value">{t.mcap}</span>
                  </div>
                  <div className="dth-modal-metric">
                    <span className="dth-modal-metric-label">Holders</span>
                    <span className="dth-modal-metric-value">{t.holders}</span>
                  </div>
                  <div className="dth-modal-metric">
                    <span className="dth-modal-metric-label">Vol 24h</span>
                    <span className="dth-modal-metric-value">{t.volume24h}</span>
                  </div>
                  <div className="dth-modal-metric">
                    <span className="dth-modal-metric-label">Top Whale</span>
                    <span className="dth-modal-metric-value">{t.topWhale}</span>
                  </div>
                  <div className="dth-modal-metric">
                    <span className="dth-modal-metric-label">LP Locked</span>
                    <span className="dth-modal-metric-value">{t.lpLocked || '-'}</span>
                  </div>
                  <div className="dth-modal-metric">
                    <span className="dth-modal-metric-label">Rug Risk</span>
                    <span className="dth-modal-metric-value" style={{ color: rColor }}>{rugLabel(t.rugRisk)} ({t.rugRisk}/8)</span>
                  </div>
                </div>

                {/* Two-column: Viral + Rug */}
                <div className="dth-modal-row dth-modal-stagger" style={{ '--stagger': 3 }}>
                  <div className="dth-modal-case dth-modal-case--bull">
                    <span className="dth-modal-case-label">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                      Viral Catalysts
                    </span>
                    <ul className="dth-modal-case-list">
                      {(t.viralCatalysts || []).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                  <div className="dth-modal-case dth-modal-case--bear">
                    <span className="dth-modal-case-label">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>
                      Rug Factors
                    </span>
                    <ul className="dth-modal-case-list">
                      {(t.rugFactors || []).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                </div>

                {/* Two-column: Whale Activity + Comparables */}
                <div className="dth-modal-row dth-modal-stagger" style={{ '--stagger': 4 }}>
                  <div className="dth-modal-section">
                    <span className="dth-modal-section-label">Whale Activity</span>
                    <p className="dth-modal-whale-note">{t.whaleActivity || '-'}</p>
                  </div>
                  {t.comparables?.length > 0 && (
                    <div className="dth-modal-section">
                      <span className="dth-modal-section-label">Comparable Memes</span>
                      <div className="dth-modal-peers">
                        {t.comparables.map((peer, j) => (
                          <div key={j} className="dth-modal-peer">
                            <span className="dth-modal-peer-symbol">{peer.symbol}</span>
                            <span className="dth-modal-peer-mcap">{peer.mcap}</span>
                            <span className="dth-modal-peer-metric">{peer.metric}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Analyst note */}
                {t.analystNote && (
                  <div className="dth-modal-section dth-modal-stagger" style={{ '--stagger': 5 }}>
                    <span className="dth-modal-section-label">Alpha Analyst Note</span>
                    <p className="dth-modal-analyst-note">{t.analystNote}</p>
                  </div>
                )}

                {/* Footer */}
                <div className="dth-modal-divider" aria-hidden="true" />
                <div className="dth-modal-footer dth-modal-stagger" style={{ '--stagger': 6 }}>
                  <div className="dth-modal-footer-left">
                    <span className="dth-modal-category">{t.category}</span>
                    {t.chain && (
                      <span className="dth-modal-chain">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                        </svg>
                        {t.chain}
                      </span>
                    )}
                  </div>
                  {t.socials && Object.keys(t.socials).length > 0 && (
                    <div className="dth-modal-socials">
                      {Object.entries(t.socials).map(([key, url]) => {
                        const icon = SOCIAL_ICONS[key]
                        if (!icon) return null
                        return (
                          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="dth-modal-social-link" title={key.charAt(0).toUpperCase() + key.slice(1)} onClick={e => e.stopPropagation()}>
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

export default DegenThesis
