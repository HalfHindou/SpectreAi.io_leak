/**
 * PreIpoCard — one company tile in the Pre-IPO roster grid.
 *
 * Glass-card per design-system.md D. Leads with the current private valuation
 * (the number IS the content), a private-appreciation multiple badge, a tiny
 * log-scaled valuation sparkline built from the round history, and an IPO
 * watch-status pill. Monochrome chrome — no hue carries meaning.
 */
import { useMemo, memo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import CompanyLogo from './company-logo'
import { formatAmount, formatRelativeDate } from './private-markets-constants'
import { preipoMeta, formatMultiple, IPO_STATUS, TIER_LABEL, companySlug } from './preipo-constants'

// Tiny log-scaled valuation sparkline. >=2 valued rounds required.
function ValuationSparkline({ series }) {
  const path = useMemo(() => {
    const pts = (series || [])
      .map((r) => r.valuationUsd)
      .filter((v) => Number.isFinite(v) && v > 0)
    if (pts.length < 2) return null
    const W = 132
    const H = 34
    const logs = pts.map((v) => Math.log10(v))
    const lo = Math.min(...logs)
    const hi = Math.max(...logs)
    const range = Math.max(hi - lo, 0.0001)
    const stepX = W / (pts.length - 1)
    const coords = logs.map((l, i) => {
      const x = i * stepX
      const y = H - 3 - ((l - lo) / range) * (H - 6)
      return [x, y]
    })
    const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    const last = coords[coords.length - 1]
    const area = `${d} L ${W} ${H} L 0 ${H} Z`
    return { d, area, last, W, H }
  }, [series])

  if (!path) return null
  return (
    <svg className="pi-card-spark" viewBox={`0 0 ${path.W} ${path.H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="piSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(245,245,247,0.16)" />
          <stop offset="100%" stopColor="rgba(245,245,247,0)" />
        </linearGradient>
      </defs>
      <path d={path.area} fill="url(#piSparkFill)" />
      <path d={path.d} fill="none" stroke="rgba(245,245,247,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={path.last[0]} cy={path.last[1]} r="2.2" fill="var(--text-primary)" />
    </svg>
  )
}

function PreIpoCard({ entry, onSelect, isActive }) {
  const { t, i18n } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)

  const meta = preipoMeta(entry.company)
  const multiple = formatMultiple(entry.valuationMultiple)
  const statusKey = meta?.status || 'private'
  const statusLabel = IPO_STATUS[statusKey] || IPO_STATUS.private
  const isLive = statusKey === 'ipo'
  const tierLabel = entry.tier ? TIER_LABEL[entry.tier] : null

  return (
    <article
      className={`pi-card glass-card${isActive ? ' pi-card-active' : ''}${isLive ? ' pi-card-live' : ''}`}
      onClick={() => onSelect(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(entry)
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={t('privateMarkets.preIpo.card.cardAria', '{{company}} - {{valuation}} {{status}}', { company: entry.company, valuation: fmtMoney(entry.currentValuation), status: statusLabel })}
    >
      <div className="pi-card-top">
        <CompanyLogo company={entry.company} logoUrl={entry.logoUrl} domain={entry.domain} className="pi-logo-md" />
        <div className="pi-card-id">
          <div className="pi-card-name heading">{entry.company}</div>
          <div className="caption pi-card-sector">{entry.sector || t('privateMarkets.dealCard.otherSector')}</div>
        </div>
        <span className={`pi-status-pill${isLive ? ' pi-status-live' : ''}`}>
          {isLive && <span className="pi-status-dot" aria-hidden="true" />}
          {statusLabel}
        </span>
      </div>

      <div className="pi-card-val-row">
        <div className="pi-card-val mono">{fmtMoney(entry.currentValuation)}</div>
        {multiple && (
          <span className="pi-card-mult mono" title={t('privateMarkets.preIpo.card.multipleTitle')}>
            {multiple}
          </span>
        )}
      </div>

      <div className="pi-card-spark-wrap">
        <ValuationSparkline series={entry.valuationSeries} />
        {tierLabel && <span className="pi-card-tier">{tierLabel}</span>}
      </div>

      <div className="pi-card-foot">
        {entry.lastRound ? (
          <span className="pi-card-round">
            {entry.lastRound}
            <span className="pi-card-round-date"> · {formatRelativeDate(entry.lastRoundDate, t, i18n.language)}</span>
          </span>
        ) : (
          <span className="pi-card-round">{t('privateMarkets.preIpo.card.privateCompany')}</span>
        )}
        {entry.investors?.length > 0 && (
          <span className="pi-card-investors" title={entry.investors.join(', ')}>
            {entry.investors.slice(0, 2).join(', ')}
            {entry.investors.length > 2 && ` +${entry.investors.length - 2}`}
          </span>
        )}
      </div>

      {/* The card body opens the quick panel; this opens the whole page. A real
          <Link>, not a click handler, so it can be middle-clicked, copied and
          shared — and stopPropagation keeps it from also firing the panel. */}
      <Link
        className="pi-card-open"
        to={`/private-markets/${companySlug(entry.company)}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={t('privateMarkets.preIpo.card.openFullPageAria', 'Open the full {{company}} page', { company: entry.company })}
      >
        {t('privateMarkets.preIpo.card.openFullPage', 'Full page')}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </Link>
    </article>
  )
}

export default memo(PreIpoCard)
