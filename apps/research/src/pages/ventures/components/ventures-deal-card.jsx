/**
 * VenturesDealCard - Project card for the Ventures grid
 * Two variants: "grid" (compact) and "featured" (hero)
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import SpectreScoreRing from './spectre-score-ring'
import { STAGE_CONFIG, CATEGORY_COLORS, getStageFromMarketCap, getScoreLabel } from './ventures-constants'

function logoHashColor(str) {
  if (!str) return 'hsl(0, 0%, 25%)'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 38%, 42%)`
}

function DealLogo({ logo, name, symbol, size = 40, className = 'ventures-card-logo' }) {
  const [broken, setBroken] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const initials = (symbol || name || '?').slice(0, 2).toUpperCase()
  const bg = logoHashColor(symbol || name)

  if (!logo || broken) {
    return (
      <div className={`${className} ventures-card-logo--fallback`}
        style={{ width: size, height: size, background: bg, fontSize: Math.max(10, Math.round(size * 0.36)) }}
        aria-hidden="true">
        {initials}
      </div>
    )
  }

  return (
    <div className="ventures-logo-wrap" style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <div className={`${className} ventures-card-logo--fallback`}
        style={{ width: size, height: size, background: bg, fontSize: Math.max(10, Math.round(size * 0.36)),
          position: 'absolute', top: 0, left: 0 }}
        aria-hidden="true">
        {initials}
      </div>
      <img src={logo} alt={name} className={className}
        style={{ width: size, height: size, opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s ease', position: 'relative', zIndex: 1 }}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)} />
    </div>
  )
}

function formatPriceChange(val) {
  if (val == null) return null
  const num = parseFloat(val)
  const sign = num >= 0 ? '+' : ''
  return `${sign}${num.toFixed(1)}%`
}

const StageBadge = ({ stage }) => {
  const config = STAGE_CONFIG[stage]
  if (!config) return null
  return (
    <span
      className="ventures-stage-badge"
      style={{ '--stage-rgb': config.color }}
    >
      {config.label}
    </span>
  )
}

const CategoryPill = ({ category }) => {
  const rgb = CATEGORY_COLORS[category] || '156, 163, 175'
  return (
    <span
      className="ventures-category-pill"
      style={{ '--cat-rgb': rgb }}
    >
      {category}
    </span>
  )
}

const DevBar = ({ score, t }) => {
  if (score == null) return <span className="ventures-metric-value">N/A</span>
  const label = score >= 80 ? t('ventures.devHigh') : score >= 50 ? t('ventures.devMed') : t('ventures.devLow')
  return (
    <div className="ventures-dev-bar-wrap">
      <div className="ventures-dev-bar">
        <div className="ventures-dev-bar-fill" style={{ width: `${score}%` }} />
      </div>
      <span className="ventures-dev-bar-label">{label}</span>
    </div>
  )
}

const VenturesDealCard = ({
  project,
  variant = 'grid',
  onClick,
  dayMode = false,
  liveData,
  index = 0,
}) => {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => (n == null ? 'N/A' : fmtLargeShort(n))
  const metrics = liveData || project.mockMetrics
  const stage = getStageFromMarketCap(metrics.marketCap)
  const change = formatPriceChange(metrics.priceChange24h)
  const isPositive = metrics.priceChange24h >= 0
  const brandRgb = CATEGORY_COLORS[project.category] || '139, 92, 246'

  if (variant === 'featured') {
    return (
      <div
        className={`ventures-featured-card ${dayMode ? 'day-mode' : ''}`}
        style={{ '--brand-rgb': brandRgb, '--card-index': index }}
        onClick={() => onClick?.(project)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onClick?.(project)}
      >
        {project.featuredReason && (
          <div className="ventures-featured-reason">{project.featuredReason}</div>
        )}
        <div className="ventures-featured-top">
          <div className="ventures-featured-identity">
            <DealLogo logo={project.logo} name={project.name} symbol={project.symbol}
              size={48} className="ventures-card-logo ventures-card-logo--lg" />
            <div>
              <div className="ventures-card-name">{project.name}</div>
              <div className="ventures-card-ticker">${project.symbol}</div>
            </div>
          </div>
          <SpectreScoreRing
            score={project.spectreScore.overall}
            size={72}
            showLabel={false}
            dayMode={dayMode}
          />
        </div>
        <p className="ventures-featured-tagline">{project.tagline}</p>
        <div className="ventures-featured-pills">
          <CategoryPill category={project.category} />
          <StageBadge stage={stage} />
        </div>
        <div className="ventures-featured-metrics">
          <div className="ventures-metric">
            <span className="ventures-metric-label">{t('ventures.marketCap')}</span>
            <span className="ventures-metric-value">{fmtMoney(metrics.marketCap)}</span>
          </div>
          {metrics.revenue30d != null && (
            <div className="ventures-metric">
              <span className="ventures-metric-label">{t('ventures.revenue30d')}</span>
              <span className="ventures-metric-value">{fmtMoney(metrics.revenue30d)}</span>
            </div>
          )}
          {metrics.tvl != null && (
            <div className="ventures-metric">
              <span className="ventures-metric-label">{t('ventures.tvl')}</span>
              <span className="ventures-metric-value">{fmtMoney(metrics.tvl)}</span>
            </div>
          )}
          <div className="ventures-metric">
            <span className="ventures-metric-label">24h</span>
            <span className={`ventures-metric-value ${isPositive ? 'positive' : 'negative'}`}>
              {change}
            </span>
          </div>
        </div>
        <div className="ventures-featured-cta">
          <span>{t('ventures.viewProject')}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    )
  }

  // Grid variant (default)
  return (
    <div
      className={`ventures-deal-card ${dayMode ? 'day-mode' : ''}`}
      style={{ '--brand-rgb': brandRgb, '--card-index': index }}
      onClick={() => onClick?.(project)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(project)}
    >
      <div className="ventures-card-header">
        <div className="ventures-card-identity">
          <DealLogo logo={project.logo} name={project.name} symbol={project.symbol}
            size={40} className="ventures-card-logo" />
          <div>
            <div className="ventures-card-name">{project.name}</div>
            <div className="ventures-card-ticker">${project.symbol}</div>
          </div>
        </div>
        <SpectreScoreRing
          score={project.spectreScore.overall}
          size={44}
          showLabel={false}
          showValue={true}
          dayMode={dayMode}
        />
      </div>
      <p className="ventures-card-tagline">{project.tagline}</p>
      <div className="ventures-card-pills">
        <CategoryPill category={project.category} />
        <StageBadge stage={stage} />
      </div>
      <div className="ventures-card-metrics">
        <div className="ventures-metric-row">
          <span className="ventures-metric-label">{t('ventures.marketCap')}</span>
          <span className="ventures-metric-value">{fmtMoney(metrics.marketCap)}</span>
        </div>
        {metrics.revenue30d != null && (
          <div className="ventures-metric-row">
            <span className="ventures-metric-label">{t('ventures.revenue30d')}</span>
            <span className="ventures-metric-value">{fmtMoney(metrics.revenue30d)}</span>
          </div>
        )}
        {metrics.monthlyActiveUsers != null && (
          <div className="ventures-metric-row">
            <span className="ventures-metric-label">{t('ventures.usersMAU')}</span>
            <span className="ventures-metric-value">
              {metrics.monthlyActiveUsers >= 1e6
                ? `${(metrics.monthlyActiveUsers / 1e6).toFixed(1)}M`
                : metrics.monthlyActiveUsers >= 1e3
                ? `${(metrics.monthlyActiveUsers / 1e3).toFixed(1)}K`
                : metrics.monthlyActiveUsers}
            </span>
          </div>
        )}
        <div className="ventures-metric-row">
          <span className="ventures-metric-label">{t('ventures.devActivity')}</span>
          <DevBar score={metrics.devActivityScore} t={t} />
        </div>
      </div>
      <div className="ventures-card-footer">
        <div className="ventures-card-score-label">
          <span className="ventures-score-text">{t('ventures.spectreScore')}</span>
          <span className="ventures-score-badge">{getScoreLabel(project.spectreScore.overall)}</span>
        </div>
        {project.smartMoneySignals?.[0] && (
          <div className="ventures-smart-money-hint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            <span>{project.smartMoneySignals[0].label}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default VenturesDealCard
