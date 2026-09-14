/**
 * AcceleratorCard — single YC / Hub71 company tile
 *
 * Glass-card aesthetic matching DealCard.
 * Shows accelerator source badge, logo, name, one-liner, batch/status metadata,
 * and a website link action.
 */
import { useState, memo } from 'react'
import { useTranslation } from 'react-i18next'

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </svg>
)

function AcceleratorCard({ company }) {
  const { t } = useTranslation()
  const [logoFailed, setLogoFailed] = useState(false)
  const accelerator = company.accelerator || 'YC'
  const initial = (company.name || '?').trim().charAt(0).toUpperCase()
  const isCrypto = !!company.isCrypto
  const batch = company.batch || null
  const status = company.status || company.stage || null

  const onCardClick = () => {
    if (company.website) {
      window.open(company.website, '_blank', 'noopener,noreferrer')
    } else if (company.url) {
      window.open(company.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <article
      className="pm-accel-card glass-card"
      onClick={onCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCardClick()
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={t('privateMarkets.accelerator.cardAria', '{{company}} - {{accelerator}} {{batch}}', { company: company.name, accelerator, batch: batch || '' })}
    >
      {/* Top: accel badge + crypto pill */}
      <div className="pm-accel-badges">
        <span className="pm-accel-source-badge">{accelerator}</span>
        {isCrypto && <span className="pm-accel-crypto-pill">{t('privateMarkets.accelerators.card.crypto')}</span>}
      </div>

      {/* Logo + name */}
      <div className="pm-accel-identity">
        <div className="pm-accel-logo" aria-hidden="true">
          {company.logoUrl && !logoFailed ? (
            <img
              src={company.logoUrl}
              alt=""
              onError={() => setLogoFailed(true)}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="pm-accel-logo-fallback">{initial}</span>
          )}
        </div>
        <div className="pm-accel-name-block">
          <div className="pm-accel-name heading">{company.name}</div>
          {batch && <div className="caption pm-accel-batch">{batch}</div>}
        </div>
      </div>

      {/* One-liner */}
      {(company.oneLiner || company.sector) && (
        <p className="body-sm pm-accel-oneliner">{company.oneLiner || company.sector}</p>
      )}

      {/* Meta footer */}
      <div className="pm-accel-footer">
        <div className="pm-accel-meta">
          {status && <span className="pm-accel-chip">{status}</span>}
          {company.teamSize ? (
            <span className="pm-accel-chip">{company.teamSize} {t('privateMarkets.accelerators.card.people')}</span>
          ) : null}
          {company.region && <span className="pm-accel-chip">{company.region}</span>}
        </div>
        {(company.website || company.url) && (
          <span className="pm-accel-link">
            <ExternalLinkIcon />
          </span>
        )}
      </div>
    </article>
  )
}

export default memo(AcceleratorCard)
