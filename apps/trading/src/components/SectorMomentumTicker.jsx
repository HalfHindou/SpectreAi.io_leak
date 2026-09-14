/**
 * SectorMomentumTicker - Standalone scrolling sector momentum bar
 * Right-to-left auto-scrolling marquee showing sector performance,
 * cycle phase, token avatars, and capital flow at a glance.
 * Click a sector card to open a detail popup.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { SECTORS, TOKENS_BY_SECTOR, SECTOR_ICON_PATHS } from '../data/narrativeConfig'
import { TOKEN_LOGOS } from '../data/alphaFeedData'
import InfoTip from './InfoTip'
import './SectorMomentumTicker.css'

/* ── Phases ── */
const PHASES = [
  { id: 'accumulation', label: 'Accumulation', color: '#10B981', desc: 'Smart money is quietly building positions' },
  { id: 'markup', label: 'Markup', color: '#34D399', desc: 'Price appreciation phase - trend is confirmed' },
  { id: 'distribution', label: 'Distribution', color: '#FBBF24', desc: 'Early holders taking profits at highs' },
  { id: 'markdown', label: 'Markdown', color: '#EF4444', desc: 'Downtrend in progress - waiting for bottom' },
]

/* ── Mock token-level data for popup ── */
const TOKEN_PERFORMANCE = {
  ai: [
    { symbol: 'TAO', change: 24.1, mcap: '$4.2B', volume: '$312M' },
    { symbol: 'FET', change: 18.9, mcap: '$2.1B', volume: '$156M' },
    { symbol: 'RNDR', change: 12.4, mcap: '$3.2B', volume: '$89M' },
    { symbol: 'OCEAN', change: 8.2, mcap: '$680M', volume: '$42M' },
    { symbol: 'AKT', change: 6.7, mcap: '$520M', volume: '$28M' },
    { symbol: 'AGIX', change: 4.3, mcap: '$410M', volume: '$18M' },
  ],
  rwa: [
    { symbol: 'ONDO', change: 15.2, mcap: '$1.8B', volume: '$45M' },
    { symbol: 'CFG', change: 8.4, mcap: '$320M', volume: '$12M' },
    { symbol: 'TRU', change: 5.1, mcap: '$180M', volume: '$8M' },
    { symbol: 'GFI', change: 3.8, mcap: '$140M', volume: '$5M' },
    { symbol: 'RIO', change: 2.2, mcap: '$90M', volume: '$3M' },
  ],
  defi: [
    { symbol: 'AAVE', change: 9.1, mcap: '$2.8B', volume: '$234M' },
    { symbol: 'UNI', change: 6.3, mcap: '$4.5B', volume: '$180M' },
    { symbol: 'MKR', change: 5.8, mcap: '$2.1B', volume: '$67M' },
    { symbol: 'LDO', change: 4.2, mcap: '$1.6B', volume: '$52M' },
    { symbol: 'CRV', change: 3.1, mcap: '$580M', volume: '$34M' },
    { symbol: 'LINK', change: 2.8, mcap: '$8.2B', volume: '$312M' },
  ],
  gaming: [
    { symbol: 'IMX', change: 11.2, mcap: '$2.4B', volume: '$89M' },
    { symbol: 'GALA', change: 7.4, mcap: '$520M', volume: '$34M' },
    { symbol: 'AXS', change: 4.1, mcap: '$780M', volume: '$28M' },
    { symbol: 'PIXEL', change: 3.2, mcap: '$180M', volume: '$12M' },
    { symbol: 'RON', change: 2.8, mcap: '$340M', volume: '$15M' },
  ],
  nft: [
    { symbol: 'BLUR', change: 6.2, mcap: '$420M', volume: '$34M' },
    { symbol: 'APE', change: 3.8, mcap: '$1.2B', volume: '$45M' },
    { symbol: 'LOOKS', change: 2.1, mcap: '$80M', volume: '$5M' },
    { symbol: 'DEGEN', change: 1.4, mcap: '$120M', volume: '$8M' },
  ],
  infra: [
    { symbol: 'SOL', change: 4.2, mcap: '$68B', volume: '$2.1B' },
    { symbol: 'AVAX', change: 1.8, mcap: '$12B', volume: '$380M' },
    { symbol: 'DOT', change: -1.2, mcap: '$8.4B', volume: '$210M' },
    { symbol: 'NEAR', change: -2.8, mcap: '$4.2B', volume: '$120M' },
    { symbol: 'SUI', change: -3.4, mcap: '$3.8B', volume: '$156M' },
    { symbol: 'TIA', change: -4.1, mcap: '$2.1B', volume: '$89M' },
  ],
  memes: [
    { symbol: 'PEPE', change: -14.2, mcap: '$3.8B', volume: '$450M' },
    { symbol: 'WIF', change: -11.8, mcap: '$2.4B', volume: '$180M' },
    { symbol: 'BONK', change: -10.4, mcap: '$1.8B', volume: '$120M' },
    { symbol: 'DOGE', change: -8.2, mcap: '$18B', volume: '$890M' },
    { symbol: 'SHIB', change: -7.1, mcap: '$8.4B', volume: '$340M' },
    { symbol: 'FLOKI', change: -9.8, mcap: '$680M', volume: '$45M' },
  ],
  layer2: [
    { symbol: 'ARB', change: -7.2, mcap: '$4.2B', volume: '$180M' },
    { symbol: 'OP', change: -6.8, mcap: '$3.1B', volume: '$120M' },
    { symbol: 'STRK', change: -9.4, mcap: '$1.2B', volume: '$56M' },
    { symbol: 'MNT', change: -5.2, mcap: '$2.8B', volume: '$89M' },
    { symbol: 'METIS', change: -8.1, mcap: '$280M', volume: '$12M' },
  ],
}

/* ── Data ── */
const MOMENTUM_DATA = [
  { sectorId: 'ai', phase: 'markup', weeklyChange: 12.3, capitalFlow: '+$142M', momentum: 82, topMover: 'TAO +24%' },
  { sectorId: 'rwa', phase: 'accumulation', weeklyChange: 8.7, capitalFlow: '+$89M', momentum: 68, topMover: 'ONDO +15%' },
  { sectorId: 'defi', phase: 'markup', weeklyChange: 6.4, capitalFlow: '+$234M', momentum: 74, topMover: 'AAVE +9%' },
  { sectorId: 'gaming', phase: 'accumulation', weeklyChange: 4.1, capitalFlow: '+$28M', momentum: 55, topMover: 'IMX +11%' },
  { sectorId: 'nft', phase: 'accumulation', weeklyChange: 2.8, capitalFlow: '+$12M', momentum: 41, topMover: 'BLUR +6%' },
  { sectorId: 'infra', phase: 'distribution', weeklyChange: -2.1, capitalFlow: '-$67M', momentum: 45, topMover: 'SOL +4%' },
  { sectorId: 'memes', phase: 'distribution', weeklyChange: -11.3, capitalFlow: '-$320M', momentum: 32, topMover: 'PEPE -14%' },
  { sectorId: 'layer2', phase: 'markdown', weeklyChange: -8.9, capitalFlow: '-$180M', momentum: 22, topMover: 'ARB -7%' },
]


/* =========================================
   SectorPopup - Detail modal
   ========================================= */
function SectorPopup({ item, onClose }) {
  const popupRef = useRef(null)
  const [visible, setVisible] = useState(false)

  // Entrance animation
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleClose = useCallback(() => {
    setVisible(false)
    setTimeout(onClose, 250)
  }, [onClose])

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) handleClose()
  }, [handleClose])

  const iconPath = SECTOR_ICON_PATHS[item.sectorId]
  const isPositive = item.weeklyChange >= 0
  // Dynamic sector → real keyTokens (symbol + change). The Research Desk feed has
  // no per-token mcap/volume, so those columns show '-' (honest > fabricated).
  // Static-fallback mode keeps the richer demo table.
  const dynKeyTokens = item.extended?.keyTokens
  const tokens = (Array.isArray(dynKeyTokens) && dynKeyTokens.length)
    ? dynKeyTokens.map((kt) => ({
        symbol: kt.symbol,
        change: typeof kt.change === 'string' ? (parseFloat(kt.change) || 0) : (Number(kt.change) || 0),
        mcap: '-',
        volume: '-',
      }))
    : (TOKEN_PERFORMANCE[item.sectorId] || [])
  const allSectorTokens = TOKENS_BY_SECTOR[item.sectorId] || []

  // Momentum color
  const momentumColor = item.momentum >= 60
    ? 'var(--bull)' : item.momentum >= 35
    ? 'var(--amber, #F59E0B)' : 'var(--bear)'

  return (
    <div
      className={`smt-popup-backdrop ${visible ? 'is-visible' : ''}`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.sector?.name} sector details`}
    >
      <div ref={popupRef} className={`smt-popup ${visible ? 'is-visible' : ''}`}>
        {/* Close button */}
        <button className="smt-popup-close" onClick={handleClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>

        {/* Header */}
        <div className="smt-popup-header">
          <div className="smt-popup-sector">
            <div className="smt-popup-icon-wrap" style={{ '--sector-color': item.sector?.color }}>
              <svg className="smt-popup-icon" viewBox="0 0 24 24" fill="none" stroke={item.sector?.color || '#fff'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={iconPath} />
              </svg>
            </div>
            <div className="smt-popup-sector-info">
              <h3 className="smt-popup-name">{item.sector?.name}</h3>
              <span className="smt-popup-count">{allSectorTokens.length} tokens in sector</span>
            </div>
          </div>
          <div className="smt-popup-change-badge">
            <span className={`smt-popup-change ${isPositive ? 'is-bull' : 'is-bear'}`}>
              {isPositive ? '+' : ''}{item.weeklyChange}%
            </span>
            <span className="smt-popup-change-label">7d</span>
          </div>
        </div>

        {/* Metrics row */}
        <div className="smt-popup-metrics">
          <div className="smt-popup-metric">
            <span className="smt-popup-metric-label">Capital Flow<InfoTip text="Net money flowing into (+) or out of (-) this sector over the past 7 days. Positive means buyers outweigh sellers." position="bottom" /></span>
            <span className={`smt-popup-metric-value ${isPositive ? 'is-bull' : 'is-bear'}`}>
              {item.capitalFlow}
            </span>
          </div>
          <div className="smt-popup-metric">
            <span className="smt-popup-metric-label">Momentum<InfoTip text="Composite strength score from 0-100 combining price trend, volume, and on-chain activity. Above 60 is bullish, below 35 is bearish." position="bottom" /></span>
            <div className="smt-popup-momentum">
              <span className="smt-popup-metric-value" style={{ color: momentumColor }}>
                {item.momentum}/100
              </span>
              <div className="smt-popup-momentum-track">
                <div
                  className="smt-popup-momentum-fill"
                  style={{ width: `${item.momentum}%`, background: momentumColor }}
                />
              </div>
            </div>
          </div>
          <div className="smt-popup-metric">
            <span className="smt-popup-metric-label">Cycle Phase<InfoTip text="Where this sector sits in the market cycle - Accumulation (smart money buying), Markup (price rising), Distribution (taking profits), or Markdown (declining)." position="bottom" /></span>
            <span className="smt-popup-metric-value smt-popup-phase">
              <span className="smt-popup-phase-dot" style={{ background: item.phase?.color }} />
              {item.phase?.label}
            </span>
          </div>
        </div>

        {/* Phase description */}
        <p className="smt-popup-phase-desc">{item.phase?.desc}</p>

        {/* Token list */}
        <div className="smt-popup-tokens">
          <div className="smt-popup-tokens-header">
            <span>Token</span>
            <span>24h Change</span>
            <span>MCap</span>
            <span>Volume</span>
          </div>
          {tokens.map((t) => {
            const logoUrl = TOKEN_LOGOS[t.symbol?.toUpperCase()]
            const tPositive = t.change >= 0
            return (
              <div key={t.symbol} className="smt-popup-token-row">
                <div className="smt-popup-token-info">
                  {logoUrl ? (
                    <img className="smt-popup-token-logo" src={logoUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="smt-popup-token-logo-fallback">{t.symbol?.charAt(0)}</span>
                  )}
                  <span className="smt-popup-token-symbol">{t.symbol}</span>
                </div>
                <span className={`smt-popup-token-change ${tPositive ? 'is-bull' : 'is-bear'}`}>
                  {tPositive ? '+' : ''}{t.change.toFixed(1)}%
                </span>
                <span className="smt-popup-token-stat">{t.mcap}</span>
                <span className="smt-popup-token-stat">{t.volume}</span>
              </div>
            )
          })}
        </div>

        {/* Token avatars row */}
        <div className="smt-popup-avatars">
          {allSectorTokens.slice(0, 10).map((symbol) => {
            const logoUrl = TOKEN_LOGOS[symbol?.toUpperCase()]
            if (!logoUrl) return null
            return (
              <img key={symbol} className="smt-popup-avatar" src={logoUrl} alt={symbol} title={symbol} loading="lazy" />
            )
          })}
          {allSectorTokens.length > 10 && (
            <span className="smt-popup-avatar-more">+{allSectorTokens.length - 10}</span>
          )}
        </div>
      </div>
    </div>
  )
}


/* =========================================
   Main: SectorMomentumTicker
   ========================================= */
function SectorMomentumTicker({ sectors } = {}) {
  const [selectedSector, setSelectedSector] = useState(null)

  // Dynamic Research-Desk sector data when present; falls back to the static
  // MOMENTUM_DATA so the marquee never renders blank (same field shape).
  const source = (Array.isArray(sectors) && sectors.length > 0) ? sectors : MOMENTUM_DATA

  const items = [...source]
    .sort((a, b) => (b.weeklyChange || 0) - (a.weeklyChange || 0))
    .map(item => {
      const sector = SECTORS.find(s => s.id === item.sectorId)
      const tokens = (TOKENS_BY_SECTOR[item.sectorId] || []).slice(0, 4)
      const phase = PHASES.find(p => p.id === item.phase)
      return { ...item, sector, tokens, phase }
    })

  const handleCardClick = useCallback((item) => {
    setSelectedSector(item)
  }, [])

  const handleClose = useCallback(() => {
    setSelectedSector(null)
  }, [])

  return (
    <>
      <div className="smt-wrap">
        <div className="smt-track">
          {/* Duplicate for seamless loop */}
          {[...items, ...items].map((item, i) => {
            const iconPath = SECTOR_ICON_PATHS[item.sectorId]
            const isPositive = item.weeklyChange >= 0
            return (
              <div
                key={`${item.sectorId}-${i}`}
                className="smt-card"
                onClick={() => handleCardClick(item)}
              >
                {/* Sector icon + name */}
                <div className="smt-card-sector">
                  <svg className="smt-card-icon" viewBox="0 0 24 24" fill="none" stroke={item.sector?.color || '#fff'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={iconPath} />
                  </svg>
                  <span className="smt-card-name">{item.sector?.name}</span>
                </div>

                {/* Change + phase */}
                <div className="smt-card-stats">
                  <span className={`smt-card-change ${isPositive ? 'is-bull' : 'is-bear'}`}>
                    {isPositive ? '+' : ''}{item.weeklyChange}%
                  </span>
                  <span className="smt-card-phase">
                    <span className="smt-card-phase-dot" style={{ background: item.phase?.color }} />
                    {item.phase?.label}<InfoTip text="Current market cycle stage for this sector - Accumulation, Markup, Distribution, or Markdown." position="top" />
                  </span>
                </div>

                {/* Momentum bar */}
                <div className="smt-card-momentum">
                  <span className="smt-card-momentum-label">{item.momentum}</span>
                  <div className="smt-card-momentum-track">
                    <div
                      className="smt-card-momentum-fill"
                      style={{
                        width: `${Math.min(item.momentum, 100)}%`,
                        background: item.momentum >= 60 ? 'var(--bull)' : item.momentum >= 35 ? 'var(--amber, #F59E0B)' : 'var(--bear)',
                      }}
                    />
                  </div>
                </div>

                {/* Token avatars */}
                <div className="smt-card-avatars">
                  {item.tokens.map((symbol, j) => {
                    const logoUrl = TOKEN_LOGOS[symbol?.toUpperCase()]
                    if (!logoUrl) return null
                    return (
                      <img key={`${symbol}-${j}`} className="smt-card-avatar" src={logoUrl} alt={symbol} loading="lazy" />
                    )
                  })}
                </div>

                {/* Capital flow + top mover */}
                <div className="smt-card-flow">
                  <span className={`smt-card-capital ${isPositive ? 'is-bull' : 'is-bear'}`}>{item.capitalFlow || '-'}<InfoTip text="Net money flowing in (+) or out (-) of this sector over the past 7 days." position="top" /></span>
                  <span className="smt-card-mover">{item.topMover || '-'}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sector detail popup - portaled to body to escape transform/overflow parents */}
      {selectedSector && createPortal(
        <SectorPopup item={selectedSector} onClose={handleClose} />,
        document.body
      )}
    </>
  )
}

export default SectorMomentumTicker
