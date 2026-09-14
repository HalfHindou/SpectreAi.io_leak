/**
 * PrivateMarketsPage — main component
 *
 * Surface 1 of the Private Markets module: live Deal Feed aggregated from
 * SEC EDGAR Form D filings + TechCrunch / Bloomberg / Crunchbase RSS.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │ Header: title + live dot + result count │
 *   │ Filter bar: sector / round / size / age │
 *   ├─────────────────┬───────────────────────┤
 *   │  Deal feed grid │ Company profile panel │
 *   │  (responsive)   │  (right sidebar)      │
 *   └─────────────────┴───────────────────────┘
 *
 * Matches .claude/rules/design-system.md glass-card + shimmer patterns.
 */
import { useState, useMemo, useCallback, useEffect, useRef, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import FreshnessTag from '@/components/freshness-tag'
import usePrivateMarkets from './use-private-markets'
import {
  SECTOR_OPTIONS,
  ROUND_OPTIONS,
  SIZE_OPTIONS,
  DATE_OPTIONS,
  formatAmount,
  buildSizeLabel,
} from './private-markets-constants'
import DealCard from './deal-card'
import PmSelect from './pm-select'
import { SPOTLIGHT } from './preipo-constants'
const CompanyProfilePrivate = lazy(() => import('./company-profile-private'))
import DealFeedSkeleton from './deal-feed-skeleton'
const AcceleratorsFeed = lazy(() => import('./accelerators-feed'))
const PreIpoCompare = lazy(() => import('./preipo-compare'))
const PreIpoTab = lazy(() => import('./pre-ipo-tab'))
const CompanySpotlight = lazy(() => import('./company-spotlight').then((m) => ({ default: m.CompanySpotlightByName })))
import './private-markets-page.css'
import './private-markets-page.day-mode.css'
import './private-markets-page.mobile.css'

// The spotlight tab is named after whichever company SPOTLIGHT points at, so
// re-pointing the config renames the tab too — the label is never a second place
// the company name has to be kept in sync.
const TABS = [
  { id: 'deals',        labelKey: 'privateMarkets.tabs.dealFeed' },
  { id: 'preipo',       labelKey: 'privateMarkets.tabs.preIpo' },
  // `label` wins over `labelKey` in the render below, so a raw label here is a
  // permanent English tab. Only the spotlight company name belongs in it.
  { id: 'spotlight',    label: SPOTLIGHT.company },
  { id: 'compare',      labelKey: 'privateMarkets.tabs.compare' },
  { id: 'accelerators', labelKey: 'privateMarkets.tabs.accelerators' },
]

const LiveDot = () => (
  <span className="pm-live-dot" aria-hidden="true">
    <span className="pm-live-dot-core" />
  </span>
)

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M6 12h12M10 18h4" />
  </svg>
)

export default function PrivateMarketsPage({ dayMode, isMobile }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)
  const { deals, stats, loading, error, refresh, lastUpdated } = usePrivateMarkets()

  // Build localized, currency-aware size labels per render so they update
  // when language / currency change.
  const sizeOptions = useMemo(
    () => SIZE_OPTIONS.map((o) => ({ value: o.id, label: buildSizeLabel(o, t, fmtLargeShort) })),
    [t, fmtLargeShort]
  )
  const dateOptions = useMemo(
    () => DATE_OPTIONS.map((o) => ({ value: o.id, label: t(o.labelKey) })),
    [t]
  )
  const sectorOptions = useMemo(
    () => SECTOR_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  )
  const roundOptions = useMemo(
    () => ROUND_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  )

  // Tab state
  const [tab, setTab] = useState('deals')

  // Filter state
  const [sector, setSector] = useState('All Sectors')
  const [round, setRound] = useState('All Rounds')
  const [sizeId, setSizeId] = useState('all')
  const [dateId, setDateId] = useState('all')
  const [selectedDeal, setSelectedDeal] = useState(null)

  const filteredDeals = useMemo(() => {
    const sizeOpt = SIZE_OPTIONS.find((o) => o.id === sizeId) || SIZE_OPTIONS[0]
    const dateOpt = DATE_OPTIONS.find((o) => o.id === dateId) || DATE_OPTIONS[4]
    const now = Date.now()

    return deals.filter((d) => {
      if (sector !== 'All Sectors' && d.sector !== sector) return false
      if (round !== 'All Rounds') {
        if (round === 'Series E+') {
          const later = ['Series E', 'Series F', 'Series G', 'Series H']
          if (!later.includes(d.roundType)) return false
        } else if (d.roundType !== round) return false
      }
      if (sizeOpt.min != null && (d.amountUsd || 0) < sizeOpt.min) return false
      if (sizeOpt.max != null && (d.amountUsd || Infinity) > sizeOpt.max) return false
      if (dateOpt.hours != null) {
        if (!d.date) return false
        const ageH = (now - Date.parse(d.date)) / (1000 * 60 * 60)
        if (Number.isNaN(ageH)) return false
        if (ageH > dateOpt.hours) return false
      }
      return true
    })
  }, [deals, sector, round, sizeId, dateId])

  const handleSelectDeal = useCallback((deal) => {
    setSelectedDeal(deal)
  }, [])
  const handleCloseProfile = useCallback(() => setSelectedDeal(null), [])

  // ── Progressive rendering ────────────────────────────────────────────
  // The Spectre fundraising backend can return 500+ rows. Painting that
  // many DealCards at once was the dominant initial-render cost — every
  // card carries a logo <img>, a backdrop-filter glass surface, and
  // multiple flex children. We render the first INITIAL_PAGE cards
  // immediately and grow the window when an IntersectionObserver sentinel
  // near the end of the visible block scrolls into view. Whenever the
  // filtered set changes (filter / search / new data), the window resets.
  const INITIAL_PAGE = 36
  const PAGE_STEP = 24
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE)
  const sentinelRef = useRef(null)

  // Lock body scroll while the mobile bottom-sheet profile is open; close on Escape.
  useEffect(() => {
    if (!isMobile || !selectedDeal) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setSelectedDeal(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [isMobile, selectedDeal])

  const filteredAmount = useMemo(
    () => filteredDeals.reduce((sum, d) => sum + (d.amountUsd || 0), 0),
    [filteredDeals]
  )

  // Keep the visible window valid without yanking a scrolled user's view.
  // `filteredDeals` gets a new array ref on every 2-min poll, so resetting
  // to INITIAL_PAGE here would snap the user back to the top every poll.
  // Instead clamp: never grow past the current list, never collapse a
  // scrolled-open window. Narrowing a filter shrinks the list -> clamp
  // pulls the count down to fit; a poll with the same length is a no-op.
  useEffect(() => {
    setVisibleCount((c) => Math.min(c, filteredDeals.length || INITIAL_PAGE))
  }, [filteredDeals])

  const visibleDeals = useMemo(
    () => filteredDeals.slice(0, visibleCount),
    [filteredDeals, visibleCount]
  )
  const hasMoreDeals = visibleCount < filteredDeals.length

  // Grow the window when the sentinel scrolls into view. rootMargin gives
  // the observer a head start so the next batch is already rendered by
  // the time the user reaches the bottom of the visible cards.
  useEffect(() => {
    if (!hasMoreDeals) return undefined
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver !== 'function') {
      // Old browser / SSR: just show everything.
      setVisibleCount(filteredDeals.length)
      return undefined
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + PAGE_STEP, filteredDeals.length))
        }
      },
      { rootMargin: '600px 0px 600px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMoreDeals, filteredDeals.length])

  // Header totals: when no filters narrow the feed, prefer the realtime stats
  // from /api/private/stats (the entire fundraising dataset). When the user
  // has filtered, fall back to the sum over visible cards so the numbers track
  // what they see.
  const filtersActive =
    sector !== 'All Sectors' || round !== 'All Rounds' || sizeId !== 'all' || dateId !== 'all'
  const headerDeals = filtersActive ? filteredDeals.length : stats?.summary?.total_rounds || deals.length
  const headerTotal = filtersActive ? filteredAmount : stats?.summary?.total_raised || filteredAmount
  const headerProjects = stats?.summary?.unique_projects || null
  const headerInvestors = stats?.summary?.unique_investors || null

  return (
    <div className={`pm-page${dayMode ? ' pm-day' : ''}${isMobile ? ' pm-mobile' : ''}`}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="pm-header">
        <div className="pm-header-titles">
          <div className="pm-header-eyebrow">
            <FreshnessTag timestamp={lastUpdated} tier="warm" label={t('privateMarkets.header.label')} />
          </div>
          <h1 className="display-lg pm-header-title">{t('privateMarkets.header.title')}</h1>
          <p className="body-lg pm-header-sub">
            {t('privateMarkets.header.description')}
          </p>
        </div>
        <div className="pm-header-stats">
          <div className="pm-stat">
            <div className="caption">{filtersActive ? t('privateMarkets.stats.filtered') : t('privateMarkets.stats.deals')}</div>
            <div className="pm-stat-value mono">{headerDeals}</div>
          </div>
          <div className="pm-stat">
            <div className="caption">{t('privateMarkets.stats.totalRaised')}</div>
            <div className="pm-stat-value mono">{fmtMoney(Number(headerTotal))}</div>
          </div>
          {!filtersActive && headerProjects && (
            <div className="pm-stat">
              <div className="caption">{t('privateMarkets.stats.projects')}</div>
              <div className="pm-stat-value mono">{headerProjects}</div>
            </div>
          )}
          {!filtersActive && headerInvestors && (
            <div className="pm-stat">
              <div className="caption">{t('privateMarkets.stats.investors')}</div>
              <div className="pm-stat-value mono">{headerInvestors}</div>
            </div>
          )}
          <button
            type="button"
            className="btn-secondary pm-refresh"
            onClick={refresh}
            disabled={loading}
            aria-label={t('privateMarkets.header.refreshAriaLabel')}
          >
            {t('privateMarkets.header.refresh')}
          </button>
        </div>
      </header>

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div className="pm-tabs" role="tablist" aria-label={t('privateMarkets.tabs.ariaLabel')}>
        {TABS.map((tabDef) => (
          <button
            key={tabDef.id}
            type="button"
            role="tab"
            aria-selected={tab === tabDef.id}
            className={`pm-tab${tab === tabDef.id ? ' pm-tab-active' : ''}`}
            onClick={() => {
              setTab(tabDef.id)
              setSelectedDeal(null)
            }}
          >
            {tabDef.label || t(tabDef.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'deals' && (
        <>
          {/* ── Filter Bar ──────────────────────────────────────────────── */}
          <div className="pm-filter-bar glass-card">
            {/* Desktop-only: on the phone the four labelled selects ARE the
                filter bar, and a "FILTERS" caption above them just costs a row. */}
            {!isMobile && (
              <div className="pm-filter-icon">
                <FilterIcon />
                <span className="subheading">{t('privateMarkets.filters.label')}</span>
              </div>
            )}
            <div className="pm-filters">
              <FilterSelect label={t('privateMarkets.filters.sector')} value={sector} options={sectorOptions} onChange={setSector} />
              <FilterSelect label={t('privateMarkets.filters.round')} value={round} options={roundOptions} onChange={setRound} />
              <FilterSelect
                label={t('privateMarkets.filters.size')}
                value={sizeId}
                options={sizeOptions}
                onChange={setSizeId}
              />
              <FilterSelect
                label={t('privateMarkets.filters.age')}
                value={dateId}
                options={dateOptions}
                onChange={setDateId}
              />
            </div>
          </div>

          {/* ── Body: feed + profile panel ──────────────────────────────── */}
          <div className={`pm-body${selectedDeal ? ' pm-body-with-profile' : ''}`}>
            <section className="pm-feed" aria-label={t('privateMarkets.feed.ariaLabel')}>
              {loading && deals.length === 0 && <DealFeedSkeleton />}

              {!loading && error && (
                <EmptyState
                  title={t('privateMarkets.empty.feedErrorTitle')}
                  message={t('privateMarkets.empty.feedErrorMessage')}
                />
              )}

              {!loading && !error && filteredDeals.length === 0 && (
                <EmptyState
                  title={t('privateMarkets.empty.noFilterTitle')}
                  message={t('privateMarkets.empty.noFilterMessage')}
                />
              )}

              {filteredDeals.length > 0 && (
                <>
                  <div className="pm-feed-grid">
                    {visibleDeals.map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        onSelect={handleSelectDeal}
                        isActive={selectedDeal?.id === deal.id}
                      />
                    ))}
                  </div>
                  {hasMoreDeals && (
                    <div
                      ref={sentinelRef}
                      className="pm-feed-sentinel"
                      aria-hidden="true"
                    />
                  )}
                </>
              )}
            </section>

            {selectedDeal && (
              <>
                <div
                  className="pm-profile-backdrop"
                  onClick={handleCloseProfile}
                  aria-hidden="true"
                />
                <aside className="pm-profile-panel" aria-label={t('privateMarkets.profile.ariaLabel')}>
                  <Suspense fallback={null}>
                    <CompanyProfilePrivate deal={selectedDeal} onClose={handleCloseProfile} />
                  </Suspense>
                </aside>
              </>
            )}
          </div>
        </>
      )}

      {tab === 'preipo' && (
        <Suspense fallback={null}><PreIpoTab isMobile={isMobile} /></Suspense>
      )}

      {tab === 'spotlight' && (
        <Suspense fallback={null}>
          <CompanySpotlight {...SPOTLIGHT} />
        </Suspense>
      )}

      {tab === 'compare' && (
        <Suspense fallback={null}>
          <PreIpoCompare seed={[SPOTLIGHT.company]} />
        </Suspense>
      )}

      {tab === 'accelerators' && (
        <Suspense fallback={null}><AcceleratorsFeed /></Suspense>
      )}
    </div>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function FilterSelect({ label, value, options, onChange }) {
  return (
    <div className="pm-filter">
      <span className="caption pm-filter-label">{label}</span>
      <PmSelect value={value} options={options} onChange={onChange} ariaLabel={label} />
    </div>
  )
}

function EmptyState({ title, message }) {
  return (
    <div className="pm-empty glass-card">
      <div className="pm-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a4 4 0 018 0v2" />
          <path d="M3 12h18" />
        </svg>
      </div>
      <h3 className="display-sm">{title}</h3>
      <p className="body pm-empty-message">{message}</p>
    </div>
  )
}
