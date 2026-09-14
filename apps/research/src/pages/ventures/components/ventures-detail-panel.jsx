/**
 * VenturesDetailPanel - Slide-over panel showing full project details
 * Rendered via createPortal to document.body
 */
import React, { useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useCurrency } from '@/hooks/useCurrency'
import SpectreScoreRing from './spectre-score-ring'
import InfoTip from '@/components/InfoTip'
import IButton from '@/components/intelligence/IButton'
import {
  STAGE_CONFIG,
  CATEGORY_COLORS,
  getStageFromMarketCap,
  getScoreColor,
  getScoreLabel,
} from './ventures-constants'

function formatPriceChange(val) {
  if (val == null) return 'N/A'
  const num = parseFloat(val)
  const sign = num >= 0 ? '+' : ''
  return `${sign}${num.toFixed(1)}%`
}

const SubScoreRow = ({ label, score, dayMode, tokenSymbol }) => {
  const color = getScoreColor(score)
  const trackBg = dayMode ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'
  return (
    <div className="ventures-subscore-row">
      <span className="ventures-subscore-label">{label}</span>
      <IButton size="sm" metricType="custom" metricValue={`${score}/100`} metricLabel={label} tokenSymbol={tokenSymbol} />
      <div className="ventures-subscore-bar-wrap">
        <div className="ventures-subscore-bar" style={{ background: trackBg }}>
          <div
            className="ventures-subscore-bar-fill"
            style={{ width: `${score}%`, background: color }}
          />
        </div>
        <span className="ventures-subscore-val" style={{ color }}>{score}</span>
      </div>
    </div>
  )
}

const VenturesDetailPanel = ({
  project,
  onClose,
  dayMode = false,
  onOpenResearchZone,
  addToWatchlist,
  isInWatchlist,
  selectToken,
  liveData,
}) => {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => (n == null ? 'N/A' : fmtLargeShort(n))
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (project) {
      requestAnimationFrame(() => setIsOpen(true))
    }
  }, [project])

  // Lock background scroll while the detail panel is open. Without this the
  // page body behind the fixed overlay still scrolls on mobile Safari, so the
  // panel feels "stuck". Matches the pattern in watchlists/mobile-bottom-sheet
  // and mobile/token-bottom-sheet (inline overflow toggle is the convention).
  useEffect(() => {
    if (!project) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [project])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setTimeout(() => onClose(), 300)
  }, [onClose])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleClose])

  if (!project) return null

  const metrics = liveData || project.mockMetrics
  const stage = getStageFromMarketCap(metrics.marketCap)
  const stageConfig = STAGE_CONFIG[stage]
  const catRgb = CATEGORY_COLORS[project.category] || '156,163,175'
  const inWatchlist = isInWatchlist?.({ symbol: project.symbol })
  const hasKeyMetrics = (
    metrics.marketCap != null ||
    metrics.fdv != null ||
    metrics.priceChange24h != null ||
    metrics.priceChange7d != null ||
    metrics.priceChange30d != null ||
    metrics.circulatingPct != null ||
    metrics.tvl != null ||
    metrics.revenue30d != null
  )

  const handleResearch = () => {
    if (selectToken) {
      selectToken({ symbol: project.symbol, name: project.name })
    }
    if (onOpenResearchZone) {
      onOpenResearchZone({ symbol: project.symbol, name: project.name })
    }
    handleClose()
  }

  const handleWatchlist = () => {
    if (addToWatchlist) {
      addToWatchlist({
        symbol: project.symbol,
        name: project.name,
        logo: project.logo,
      })
    }
  }

  const panel = (
    <div className={`ventures-panel-backdrop ${isOpen ? 'open' : ''}`} onClick={handleClose}>
      <div
        className={`ventures-panel ${isOpen ? 'open' : ''} ${dayMode ? 'day-mode' : ''}`}
        style={{ '--brand-rgb': catRgb }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ventures-panel-header">
          <div className="ventures-panel-identity">
            <img
              src={project.logo}
              alt={project.name}
              className="ventures-panel-logo"
              onError={(e) => { e.target.style.display = 'none' }}
            />
            <div>
              <h2 className="ventures-panel-name">{project.name}</h2>
              <div className="ventures-panel-sub">
                <span className="ventures-panel-ticker">${project.symbol}</span>
                <span
                  className="ventures-stage-badge"
                  style={{ '--stage-rgb': stageConfig?.color || '156,163,175' }}
                >
                  {stage}
                </span>
                <span
                  className="ventures-category-pill"
                  style={{ '--cat-rgb': catRgb }}
                >
                  {project.category}
                </span>
              </div>
            </div>
          </div>
          <button className="ventures-panel-close" onClick={handleClose} aria-label={t('common.close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="ventures-panel-body">
          {/* Spectre Score */}
          <section className="ventures-panel-section">
            <InfoTip text="Composite investment score (0–100) based on five pillars: Fundamentals, Team & Development, Tokenomics Health, Community Sentiment, and Smart Money activity. Higher is better." position="right" />
            <div className="ventures-score-hero">
              <SpectreScoreRing
                score={project.spectreScore.overall}
                size={120}
                label={getScoreLabel(project.spectreScore.overall)}
                showLabel={true}
                dayMode={dayMode}
              />
              <IButton size="sm" metricType="custom" metricValue={`${project.spectreScore.overall}/100 — ${getScoreLabel(project.spectreScore.overall)}`} metricLabel="Spectre Score" tokenSymbol={project.symbol} />
            </div>
            <div className="ventures-subscores">
              <SubScoreRow label={t('ventures.fundamentals')} score={project.spectreScore.fundamentals} dayMode={dayMode} tokenSymbol={project.symbol} />
              <SubScoreRow label={t('ventures.teamDev')} score={project.spectreScore.teamDevelopment} dayMode={dayMode} tokenSymbol={project.symbol} />
              <SubScoreRow label={t('ventures.tokenomics')} score={project.spectreScore.tokenomicsHealth} dayMode={dayMode} tokenSymbol={project.symbol} />
              <SubScoreRow label={t('ventures.community')} score={project.spectreScore.communitySentiment} dayMode={dayMode} tokenSymbol={project.symbol} />
              <SubScoreRow label={t('ventures.smartMoney')} score={project.spectreScore.smartMoney} dayMode={dayMode} tokenSymbol={project.symbol} />
            </div>
          </section>

          {/* Quick Stats */}
          {hasKeyMetrics && (
          <section className="ventures-panel-section">
            <h3 className="ventures-panel-section-title">{t('ventures.keyMetrics')}<InfoTip text="Core financial metrics including market cap, fully diluted valuation (FDV), multi-timeframe price changes, circulating supply ratio, TVL, and protocol revenue." position="right" /></h3>
            <div className="ventures-quick-stats">
              {metrics.marketCap != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.marketCap')}</span>
                  <span className="ventures-stat-value">{fmtMoney(metrics.marketCap)}</span>
                </div>
              )}
              {metrics.fdv != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.fdv')}</span>
                  <span className="ventures-stat-value">{fmtMoney(metrics.fdv)}</span>
                </div>
              )}
              {metrics.priceChange24h != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.change24h')}</span>
                  <span className={`ventures-stat-value ${metrics.priceChange24h >= 0 ? 'positive' : 'negative'}`}>
                    {formatPriceChange(metrics.priceChange24h)}
                  </span>
                </div>
              )}
              {metrics.priceChange7d != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.change7d')}</span>
                  <span className={`ventures-stat-value ${metrics.priceChange7d >= 0 ? 'positive' : 'negative'}`}>
                    {formatPriceChange(metrics.priceChange7d)}
                  </span>
                </div>
              )}
              {metrics.priceChange30d != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.change30d')}</span>
                  <span className={`ventures-stat-value ${metrics.priceChange30d >= 0 ? 'positive' : 'negative'}`}>
                    {formatPriceChange(metrics.priceChange30d)}
                  </span>
                </div>
              )}
              {metrics.circulatingPct != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.circulating')}</span>
                  <span className="ventures-stat-value">{`${metrics.circulatingPct}%`}</span>
                </div>
              )}
              {metrics.tvl != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.tvl')}</span>
                  <span className="ventures-stat-value">{fmtMoney(metrics.tvl)}</span>
                </div>
              )}
              {metrics.revenue30d != null && (
                <div className="ventures-stat-cell">
                  <span className="ventures-stat-label">{t('ventures.revenue30d')}</span>
                  <span className="ventures-stat-value">{fmtMoney(metrics.revenue30d)}</span>
                </div>
              )}
            </div>
          </section>
          )}

          {/* AI Brief */}
          <section className="ventures-panel-section">
            <h3 className="ventures-panel-section-title">{t('ventures.aiBrief')}<InfoTip text="AI-generated executive summary of the project's value proposition, competitive position, risks, and growth potential. Think of it as a VC memo in one paragraph." position="right" /></h3>
            <div className="ventures-ai-brief">
              <p>{project.aiBrief}</p>
              <div className="ventures-ai-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{t('ventures.generatedByAI')}</span>
              </div>
            </div>
          </section>

          {/* Team & Backers */}
          <section className="ventures-panel-section">
            <h3 className="ventures-panel-section-title">{t('ventures.teamBackers')}<InfoTip text="Core team members and notable VC/institutional backers. Anonymous (Anon) founders are common in DeFi — look at development activity and backer quality instead." position="right" /></h3>
            <div className="ventures-team-list">
              {(project.team || []).map((member) => (
                <div key={`team-${member.name}-${member.role}`} className="ventures-team-member">
                  <div className="ventures-team-avatar">
                    {member.isAnon ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    ) : (
                      <span>{member.name.charAt(0)}</span>
                    )}
                  </div>
                  <div>
                    <div className="ventures-team-name">
                      {member.name}
                      {member.isAnon && <span className="ventures-anon-tag">{t('ventures.anon')}</span>}
                    </div>
                    <div className="ventures-team-role">{member.role}</div>
                  </div>
                </div>
              ))}
            </div>
            {project.backers?.length > 0 && (
              <div className="ventures-backers">
                <span className="ventures-backers-label">{t('ventures.backedBy')}</span>
                <div className="ventures-backers-list">
                  {project.backers.map((backer) => (
                    <span key={`backer-${backer.name}`} className="ventures-backer-pill">{backer.name}</span>
                  ))}
                </div>
                {project.totalRaised && (
                  <span className="ventures-total-raised">{t('ventures.totalRaised')} {project.totalRaised}</span>
                )}
              </div>
            )}
          </section>

          {/* Tokenomics */}
          {project.tokenomics?.allocations && (
            <section className="ventures-panel-section">
              <h3 className="ventures-panel-section-title">{t('ventures.tokenomics')}<InfoTip text="Token supply allocation breakdown. Shows how tokens are distributed between team, investors, community, treasury, and ecosystem. Watch for high insider allocations or upcoming unlock events." position="right" /></h3>
              <div className="ventures-tokenomics">
                {project.tokenomics.allocations.map((alloc, i) => {
                  const hue = (i * 72) + 180
                  return (
                    <div key={`alloc-${alloc.label}`} className="ventures-alloc-row">
                      <div className="ventures-alloc-info">
                        <span
                          className="ventures-alloc-dot"
                          style={{ background: `hsl(${hue}, 60%, 60%)` }}
                        />
                        <span className="ventures-alloc-label">{alloc.label}</span>
                      </div>
                      <div className="ventures-alloc-bar-wrap">
                        <div className="ventures-alloc-bar">
                          <div
                            className="ventures-alloc-bar-fill"
                            style={{
                              width: `${alloc.percentage}%`,
                              background: `hsl(${hue}, 60%, 60%)`,
                            }}
                          />
                        </div>
                        <span className="ventures-alloc-pct">{alloc.percentage}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Smart Money Signals */}
          {project.smartMoneySignals?.length > 0 && (
            <section className="ventures-panel-section">
              <h3 className="ventures-panel-section-title">{t('ventures.smartMoneySignals')}<InfoTip text="Notable on-chain activity from known institutional wallets, VCs, and whale addresses. These signals can indicate accumulation, distribution, or major position changes." position="right" /></h3>
              <div className="ventures-signals">
                {project.smartMoneySignals.map((signal) => (
                  <div key={`signal-${signal.label}-${signal.date}`} className="ventures-signal-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span className="ventures-signal-text">{signal.label}</span>
                    <span className="ventures-signal-date">{signal.date}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Competitive Landscape */}
          {project.competitors?.length > 0 && (
            <section className="ventures-panel-section">
              <h3 className="ventures-panel-section-title">{t('ventures.competitiveLandscape')}<InfoTip text="Side-by-side comparison with direct competitors in the same category. Compares market cap and Spectre Score to help you gauge relative positioning." position="right" /></h3>
              <div className="ventures-competitors">
                <div className="ventures-comp-header">
                  <span>{t('ventures.project')}</span>
                  <span>{t('ventures.mcap')}</span>
                  <span>{t('ventures.score')}</span>
                </div>
                <div className="ventures-comp-row ventures-comp-row--current">
                  <span>{project.name} ({project.symbol})</span>
                  <span>{fmtMoney(metrics.marketCap)}</span>
                  <span style={{ color: getScoreColor(project.spectreScore.overall) }}>
                    {project.spectreScore.overall}
                  </span>
                </div>
                {project.competitors.map((comp) => (
                  <div key={`comp-${comp.symbol}`} className="ventures-comp-row">
                    <span>{comp.name} ({comp.symbol})</span>
                    <span>{fmtMoney(comp.marketCap)}</span>
                    <span style={{ color: getScoreColor(comp.spectreScore) }}>
                      {comp.spectreScore}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Action Footer */}
        <div className="ventures-panel-footer">
          <button className="ventures-action-btn ventures-action-btn--primary" onClick={handleResearch}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
            {t('ventures.openResearchZone')}
          </button>
          <button
            className={`ventures-action-btn ventures-action-btn--secondary ${inWatchlist ? 'active' : ''}`}
            onClick={handleWatchlist}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={inWatchlist ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {inWatchlist ? t('ventures.inWatchlist') : t('ventures.addToWatchlist')}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}

export default VenturesDetailPanel
