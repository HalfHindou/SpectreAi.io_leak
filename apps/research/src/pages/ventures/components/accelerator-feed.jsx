/**
 * AcceleratorFeed — crypto-first YC deal feed.
 *
 * Pulls YC directly from yc-oss.github.io (CORS-open, free, daily updates).
 * Filters to crypto only by default. Search + batch + status filters.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getUnifiedAcceleratorFeed } from './accelerator-api'
import VenturesDropdown from './ventures-dropdown'
import './accelerator-feed.css'
import './accelerator-feed.day-mode.css'
import './accelerator-feed.mobile.css'

const SOURCE_COLORS = {
  YC: { fg: '#FF6600', bg: 'rgba(255, 102, 0, 0.12)', border: 'rgba(255, 102, 0, 0.3)' },
}

const STATUS_COLORS = {
  Active:   '#34d399',
  Public:   '#fbbf24',
  Acquired: '#a78bfa',
  Inactive: 'rgba(245, 245, 247, 0.4)',
}

// ═══════════════════════════════════════════════════════════════════════════
// Logo with fallback to DDG icons (via website domain) then to initials
// ═══════════════════════════════════════════════════════════════════════════

function logoFromDomain(domain) {
  if (!domain) return null
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`
}

function extractDomain(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function CompanyLogo({ company, size = 44 }) {
  const [step, setStep] = useState(0)
  // Stage 0: company.logo (from YC)
  // Stage 1: DDG icon from website domain
  // Stage 2: initials fallback
  const domain = company.logo_domain || extractDomain(company.website)
  const src =
    step === 0 && company.logo ? company.logo
    : step === 1 && domain ? logoFromDomain(domain)
    : null
  const initials = (company.name || '?').slice(0, 2).toUpperCase()

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="acc-logo"
        loading="lazy"
        style={{ width: size, height: size }}
        onError={() => setStep((s) => s + 1)}
      />
    )
  }
  return (
    <div
      className="acc-logo acc-logo--fallback"
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.36)) }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Single company card
// ═══════════════════════════════════════════════════════════════════════════

function AccCard({ company }) {
  const { t } = useTranslation()
  const src = SOURCE_COLORS[company.source] || SOURCE_COLORS.YC
  const statusColor = STATUS_COLORS[company.status] || STATUS_COLORS.Inactive

  const handleClick = useCallback(() => {
    if (company.url) {
      window.open(company.url, '_blank', 'noopener,noreferrer')
    } else if (company.website) {
      window.open(company.website, '_blank', 'noopener,noreferrer')
    }
  }, [company])

  return (
    <article
      className="acc-card"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      <div className="acc-card-head">
        <CompanyLogo company={company} size={44} />
        <div className="acc-card-identity">
          <div className="acc-card-name-row">
            <h3 className="acc-card-name">{company.name}</h3>
            {company.top_company && (
              <span className="acc-card-top-badge" title={t('ventures.accelerators.topCompanyTitle')}>{t('ventures.accelerators.topCompany')}</span>
            )}
          </div>
          <div className="acc-card-meta">
            <span
              className="acc-src-pill"
              style={{ color: src.fg, background: src.bg, borderColor: src.border }}
            >
              {company.source}
            </span>
            {company.batch && (
              <span className="acc-meta-chip">{company.batch}</span>
            )}
            {company.status && (
              <span className="acc-meta-chip" style={{ color: statusColor, borderColor: `${statusColor}40` }}>
                {company.status}
              </span>
            )}
          </div>
        </div>
      </div>

      {company.one_liner && (
        <p className="acc-card-oneliner">{company.one_liner}</p>
      )}

      <div className="acc-card-tags">
        {(company.tags || []).slice(0, 4).map((tag) => {
          const isCrypto = /crypto|web3|blockchain|defi|nft|bitcoin|ethereum|stablecoin/i.test(tag)
          return (
            <span
              key={tag}
              className={`acc-tag${isCrypto ? ' acc-tag--crypto' : ''}`}
            >
              {tag}
            </span>
          )
        })}
      </div>

      <div className="acc-card-foot">
        {company.team_size ? (
          <span className="acc-card-stat">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            {company.team_size}
          </span>
        ) : company.region ? (
          <span className="acc-card-stat">{company.region}</span>
        ) : (
          <span className="acc-card-stat">{company.stage || '—'}</span>
        )}
        <span className="acc-card-link">
          {t('ventures.visitLink', 'Visit')}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </span>
      </div>
    </article>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Root component
// ═══════════════════════════════════════════════════════════════════════════

const AcceleratorFeed = () => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [feed, setFeed] = useState({ companies: [], total: 0, sources: {}, batches: [] })
  const [batchFilter, setBatchFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getUnifiedAcceleratorFeed()
      .then((data) => {
        if (cancelled) return
        if (!data || !Array.isArray(data.companies) || data.companies.length === 0) {
          setError(true)
        } else {
          setFeed(data)
        }
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    let list = feed.companies || []
    if (batchFilter !== 'all') {
      list = list.filter((c) => c.batch === batchFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((c) => {
        const name = (c.name || '').toLowerCase()
        const one = (c.one_liner || '').toLowerCase()
        const long = (c.long_description || '').toLowerCase()
        const tags = (c.tags || []).join(' ').toLowerCase()
        return name.includes(q) || one.includes(q) || long.includes(q) || tags.includes(q)
      })
    }
    return list
  }, [feed.companies, batchFilter, searchQuery])

  return (
    <div className="acc-feed">
      <header className="acc-feed-header">
        <div className="acc-feed-title-row">
          <div>
            <span className="acc-feed-eyebrow">{t('ventures.accelerators.dealFeed')}</span>
            <h2 className="acc-feed-title">{t('ventures.accelerators.pipeline')}</h2>
            <p className="acc-feed-sub">
              {t('ventures.accelerators.pipelineSub')}
            </p>
          </div>
          <div className="acc-feed-stats">
            <div className="acc-stat">
              <div className="acc-stat-value" style={{ color: SOURCE_COLORS.YC.fg }}>{feed.sources?.yc ?? feed.total ?? 0}</div>
              <div className="acc-stat-label">{t('ventures.accelerators.ycCrypto')}</div>
            </div>
          </div>
        </div>

        <div className="acc-controls">
          <div className="acc-search-wrap">
            <svg className="acc-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="acc-search"
              placeholder={t('ventures.accelerators.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {feed.batches && feed.batches.length > 0 && (
            <VenturesDropdown
              value={batchFilter}
              onChange={setBatchFilter}
              options={[
                { value: 'all', label: t('ventures.accelerators.allBatches') },
                ...feed.batches.map((b) => ({ value: b, label: b })),
              ]}
            />
          )}
        </div>
      </header>

      {loading && (
        <div className="acc-feed-state">
          <div className="acc-skeleton-grid">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="acc-skeleton" />
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="acc-feed-state acc-feed-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>{t('ventures.accelerators.ycUnavailable')}</div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="acc-feed-state acc-feed-empty">
          <div>{t('ventures.accelerators.noCompaniesMatch')}</div>
          <button
            type="button"
            className="acc-reset"
            onClick={() => { setBatchFilter('all'); setSearchQuery('') }}
          >
            {t('ventures.accelerators.resetFilters')}
          </button>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="acc-card-grid">
          {filtered.map((c) => (
            <AccCard key={c.id} company={c} />
          ))}
        </div>
      )}
    </div>
  )
}

export default AcceleratorFeed
