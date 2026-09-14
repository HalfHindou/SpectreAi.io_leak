/**
 * CompanyProfilePrivate — side panel showing a single deal in detail
 *
 * Phase 1: headline, description, metadata, "open source" external link.
 * Phase 2 will layer the valuation history chart (TradingView Lightweight
 * Charts v5 per SPECTRE_CHART_OVERHAUL.md) and Crunchbase enrichment.
 *
 * Layout matches the glass-card pattern and uses near-invisible borders
 * per .claude/rules/design-system.md.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { getCompanyBySlug, getValuationHistory } from './private-markets-api'
import ValuationHistoryChart from './valuation-history-chart'
import {
  roundBadgeTier,
  SOURCE_LABELS,
  formatAmount,
  formatRelativeDate,
  companySlug,
} from './private-markets-constants'

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const ExternalLink = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </svg>
)

export default function CompanyProfilePrivate({ deal, onClose }) {
  const { t, i18n } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)
  const [logoFailed, setLogoFailed] = useState(false)
  const [cbCompany, setCbCompany] = useState(null)
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Best-effort Crunchbase fetch — null when CRUNCHBASE_KEY not configured
  useEffect(() => {
    let cancelled = false
    const slug = companySlug(deal?.company)
    if (!slug) return
    getCompanyBySlug(slug).then((data) => {
      if (!cancelled) setCbCompany(data)
    })
    return () => {
      cancelled = true
    }
  }, [deal?.company])

  // Fetch valuation history (curated seed + DeFiLlama when available)
  useEffect(() => {
    let cancelled = false
    if (!deal?.company) {
      setHistory(null)
      return
    }
    setHistoryLoading(true)
    setHistory(null)
    getValuationHistory(deal.company).then((data) => {
      if (cancelled) return
      setHistory(data)
      setHistoryLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [deal?.company])

  if (!deal) return null

  const roundTier = roundBadgeTier(deal.roundType)
  const sourceLabel = SOURCE_LABELS[deal.sourceBadge] || deal.sourceBadge || t('privateMarkets.profile.sourceFallback')
  const initial = (deal.company || '?').trim().charAt(0).toUpperCase()

  const description =
    cbCompany?.description ||
    deal.description ||
    t('privateMarkets.profile.descriptionNA')

  return (
    <div className="pm-profile glass-card">
      <div className="pm-profile-handle" aria-hidden="true" />
      <button
        type="button"
        className="pm-profile-close btn-ghost"
        onClick={onClose}
        aria-label={t('common.close')}
      >
        <CloseIcon />
      </button>

      {/* ── Header identity block ──────────────────────────────── */}
      <div className="pm-profile-identity">
        <div className="pm-profile-logo" aria-hidden="true">
          {deal.logoUrl && !logoFailed ? (
            <img
              src={deal.logoUrl}
              alt=""
              onError={() => setLogoFailed(true)}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="pm-profile-logo-fallback">{initial}</span>
          )}
        </div>
        <div className="pm-profile-titles">
          <h2 className="display-md pm-profile-name">{deal.company || t('privateMarkets.profile.unknownCompany')}</h2>
          <div className="pm-profile-meta">
            <span className="caption">{deal.sector || t('privateMarkets.profile.otherSector')}</span>
            {cbCompany?.headquarters && (
              <>
                <span className="pm-dot" />
                <span className="caption">{cbCompany.headquarters}</span>
              </>
            )}
            {cbCompany?.foundedOn && (
              <>
                <span className="pm-dot" />
                <span className="caption">{t('privateMarkets.profile.founded', { year: new Date(cbCompany.foundedOn).getFullYear() })}</span>
              </>
            )}
          </div>
        </div>
        {deal.roundType && (
          <span className={`pm-profile-badge pm-round-${roundTier}`}>
            {deal.roundType}
          </span>
        )}
      </div>

      {/* ── Amount + date row ──────────────────────────────────── */}
      <div className="pm-profile-stat-row">
        <div className="pm-profile-stat">
          <div className="caption">{t('privateMarkets.profile.amount')}</div>
          <div className="pm-profile-stat-value mono">{fmtMoney(deal.amountUsd)}</div>
        </div>
        {cbCompany?.valuationUsd != null && (
          <div className="pm-profile-stat">
            <div className="caption">{t('privateMarkets.profile.valuation')}</div>
            <div className="pm-profile-stat-value mono">{fmtMoney(cbCompany.valuationUsd)}</div>
          </div>
        )}
        {cbCompany?.fundingTotalUsd != null && (
          <div className="pm-profile-stat">
            <div className="caption">{t('privateMarkets.profile.totalRaised')}</div>
            <div className="pm-profile-stat-value mono">{fmtMoney(cbCompany.fundingTotalUsd)}</div>
          </div>
        )}
        <div className="pm-profile-stat">
          <div className="caption">{t('privateMarkets.profile.announced')}</div>
          <div className="pm-profile-stat-value mono">{formatRelativeDate(deal.date, t, i18n.language)}</div>
        </div>
      </div>

      {/* ── Description ───────────────────────────────────────── */}
      <section className="pm-profile-section">
        <div className="subheading pm-profile-section-title">{t('privateMarkets.profile.signal')}</div>
        <p className="body pm-profile-description">{description}</p>
      </section>

      {/* ── Investors (when Crunchbase available) ─────────────── */}
      {cbCompany?.investors?.length > 0 && (
        <section className="pm-profile-section">
          <div className="subheading pm-profile-section-title">{t('privateMarkets.profile.investors')}</div>
          <div className="pm-profile-chips">
            {cbCompany.investors.slice(0, 12).map((inv) => (
              <span key={inv} className="pm-profile-chip">
                {inv}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Valuation history chart ─────────────────────────── */}
      <section className="pm-profile-section">
        <div className="pm-profile-chart-header">
          <div className="subheading pm-profile-section-title">{t('privateMarkets.profile.chart.title')}</div>
          {history?.latestValuation && (
            <div className="pm-profile-chart-latest mono">
              {t('privateMarkets.profile.chart.latest')} <span className="pm-profile-chart-latest-val">{fmtMoney(history.latestValuation)}</span>
            </div>
          )}
        </div>
        <ValuationHistoryChart history={history} loading={historyLoading} />
        {history?.rounds?.length > 0 && (
          <div className="pm-profile-rounds-list">
            {history.rounds
              .slice()
              .reverse()
              .slice(0, 6)
              .map((r, i) => (
                <div key={`${r.date}-${i}`} className="pm-profile-round-row">
                  <span className="caption pm-profile-round-date">
                    {new Date(r.date).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' })}
                  </span>
                  <span className="pm-profile-round-type">{r.roundType || '—'}</span>
                  <span className="mono pm-profile-round-amt">{fmtMoney(r.amountUsd)}</span>
                  <span className="mono pm-profile-round-val">
                    {r.valuationUsd ? `@ ${fmtMoney(r.valuationUsd)}` : ''}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* ── Footer actions ───────────────────────────────────── */}
      <footer className="pm-profile-footer">
        <div className="pm-profile-source">{sourceLabel}</div>
        {deal.link && (
          <a
            href={deal.link}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary pm-profile-source-link"
          >
            {t('privateMarkets.profile.openSource')}
            <ExternalLink />
          </a>
        )}
      </footer>
    </div>
  )
}
