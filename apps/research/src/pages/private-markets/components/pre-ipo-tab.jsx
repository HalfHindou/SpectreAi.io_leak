/**
 * PreIpoTab — Private Markets › Pre-IPO surface.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ HERO — featured listing (SpaceX) + live X tweet rail        │
 *   ├───────────────────────────────────────────────────────────┤
 *   │ Toolbar: roster stats · sector chips · sort · search        │
 *   ├──────────────────────────────┬────────────────────────────┤
 *   │ Roster grid (PreIpoCard)      │ Company detail (on select)  │
 *   └──────────────────────────────┴────────────────────────────┘
 *
 * Reuses the deal-feed body/profile layout (.pm-body / .pm-profile-panel /
 * .pm-profile-backdrop) so the sidebar→bottom-sheet behaviour is identical.
 */
import { useState, useMemo, useEffect, useCallback, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import usePreIPO from './use-preipo'
import PreIpoHero from './pre-ipo-hero'
import PreIpoCard from './pre-ipo-card'
import PmSelect from './pm-select'
import { formatAmount } from './private-markets-constants'
import { FEATURED, SORT_OPTIONS, preipoMeta } from './preipo-constants'
import './pre-ipo.css'
import './pre-ipo.day-mode.css'
import './pre-ipo.mobile.css'
const PreIpoProfile = lazy(() => import('./pre-ipo-profile'))
const LiveCoverage = lazy(() => import('./live-coverage'))

const FEATURED_TICKER = (preipoMeta(FEATURED.company)?.ticker || FEATURED.ticker || '').replace(/^\$/, '')

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

function GridSkeleton() {
  return (
    <div className="pi-grid">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className={`pi-card glass-card pi-skel-card stagger-${Math.min(5, (i % 5) + 1)}`}>
          <div className="pi-card-top">
            <div className="pi-logo pi-logo-md pi-skel pi-skel-circle animate-shimmer" />
            <div className="pi-card-id">
              <div className="pi-skel pi-skel-line pi-skel-line-lg animate-shimmer" />
              <div className="pi-skel pi-skel-line pi-skel-line-sm animate-shimmer" />
            </div>
            <div className="pi-skel pi-skel-pill animate-shimmer" />
          </div>
          <div className="pi-skel pi-skel-line pi-skel-line-xl animate-shimmer" />
          <div className="pi-skel pi-skel-line pi-skel-line-md animate-shimmer" />
        </div>
      ))}
    </div>
  )
}

export default function PreIpoTab({ isMobile }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fmtMoney = (n) => formatAmount(n, fmtLargeShort)
  const { roster, summary, loading, featured } = usePreIPO()

  // The freshest round anywhere on the roster — the honest headline date for a
  // board of last-private marks. Computed from the roster so it corrects itself
  // the day a fresh round lands.
  const rosterAsOf = useMemo(() => {
    let newest = null
    for (const r of roster || []) {
      const t = r?.lastRoundDate ? Date.parse(r.lastRoundDate) : NaN
      if (Number.isFinite(t) && (newest == null || t > newest)) newest = t
    }
    return newest == null
      ? null
      : new Date(newest).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }, [roster])

  const [sector, setSector] = useState('All')
  const [sortBy, setSortBy] = useState('valuation')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const sortOptions = useMemo(
    () => SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  )

  const sectorChips = useMemo(() => {
    const sectors = summary?.sectors || [...new Set(roster.map((r) => r.sector).filter(Boolean))].sort()
    return ['All', ...sectors]
  }, [summary, roster])

  const featuredEntry = useMemo(
    () => roster.find((r) => r.company === FEATURED.company) || null,
    [roster]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = roster.filter((r) => r.company !== FEATURED.company)
    if (sector !== 'All') list = list.filter((r) => r.sector === sector)
    if (q) {
      list = list.filter(
        (r) =>
          r.company.toLowerCase().includes(q) ||
          (r.investors || []).some((inv) => inv.toLowerCase().includes(q))
      )
    }
    const sorted = [...list]
    switch (sortBy) {
      case 'multiple':
        sorted.sort((a, b) => (b.valuationMultiple || 0) - (a.valuationMultiple || 0))
        break
      case 'raised':
        sorted.sort((a, b) => (b.totalRaised || 0) - (a.totalRaised || 0))
        break
      case 'recent':
        sorted.sort((a, b) => (Date.parse(b.lastRoundDate) || 0) - (Date.parse(a.lastRoundDate) || 0))
        break
      default:
        sorted.sort((a, b) => (b.currentValuation || 0) - (a.currentValuation || 0))
    }
    return sorted
  }, [roster, sector, sortBy, search])

  const handleSelect = useCallback((entry) => setSelected(entry), [])
  const handleClose = useCallback(() => setSelected(null), [])

  // Mobile bottom-sheet: lock body scroll + Escape-to-close (mirrors the deal feed).
  useEffect(() => {
    if (!isMobile || !selected) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [isMobile, selected])

  return (
    <div className="pi-tab">
      <PreIpoHero entry={featuredEntry} featured={featured} onOpen={handleSelect} />

      {featuredEntry && FEATURED.tvSymbol && (
        <Suspense fallback={null}>
          <LiveCoverage company={FEATURED.company} ticker={FEATURED_TICKER} query={FEATURED.company} />
        </Suspense>
      )}

      {/* Toolbar */}
      <div className="pi-toolbar glass-card">
        <div className="pi-toolbar-stats">
          <div className="pm-stat">
            <div className="caption">{t('privateMarkets.preIpo.toolbar.companies')}</div>
            <div className="pm-stat-value mono">{summary?.count ?? roster.length}</div>
          </div>
          <div className="pm-stat">
            <div className="caption">{t('privateMarkets.preIpo.toolbar.combinedValue')}</div>
            <div className="pm-stat-value mono">{fmtMoney(summary?.totalValuation)}</div>
          </div>
          <div className="pm-stat pi-stat-hide-sm">
            <div className="caption">{t('privateMarkets.preIpo.toolbar.decacorns')}</div>
            <div className="pm-stat-value mono">{summary?.decacorns ?? '—'}</div>
          </div>
        </div>
        <div className="pi-toolbar-controls">
          <div className="pi-sector-chips" role="tablist" aria-label={t('privateMarkets.preIpo.toolbar.sectorAria')}>
            {sectorChips.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={sector === s}
                className={`pi-chip-btn${sector === s ? ' pi-chip-btn-active' : ''}`}
                onClick={() => setSector(s)}
              >
                {s === 'All' ? t('privateMarkets.preIpo.toolbar.allSectors') : s}
              </button>
            ))}
          </div>
          <div className="pi-toolbar-right">
            <label className="pi-search">
              <SearchIcon />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('privateMarkets.preIpo.toolbar.searchPlaceholder')}
                aria-label={t('privateMarkets.preIpo.toolbar.searchPlaceholder')}
              />
            </label>
            <PmSelect
              className="pi-sort-select"
              value={sortBy}
              options={sortOptions}
              onChange={setSortBy}
              ariaLabel={t('privateMarkets.preIpo.toolbar.sortAria')}
            />
          </div>
        </div>
      </div>

      {/* This board is a curated roster, not a feed: the newest round on it is
          typically the better part of two years old, and it was sitting under
          the page's live dot with nothing saying so. The date is computed from
          the roster itself, so it corrects itself the day a fresh round lands. */}
      {rosterAsOf ? (
        <p className="pi-asof">
          {t('privateMarkets.preIpo.asOf', 'Curated roster · most recent round {{date}}. Valuations are last-private marks, not live prices.', { date: rosterAsOf })}
        </p>
      ) : null}

      {/* Roster + detail */}
      <div className={`pm-body${selected ? ' pm-body-with-profile' : ''}`}>
        <section className="pi-feed" aria-label={t('privateMarkets.preIpo.toolbar.rosterAria')}>
          {loading && roster.length === 0 ? (
            <GridSkeleton />
          ) : visible.length === 0 ? (
            <div className="pm-empty glass-card">
              <div className="pm-empty-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 18v4M16.24 16.24l2.83 2.83M18 12h4M16.24 7.76l2.83-2.83" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </div>
              <h3 className="display-sm">{t('privateMarkets.preIpo.empty.title')}</h3>
              <p className="body pm-empty-message">{t('privateMarkets.preIpo.empty.message')}</p>
            </div>
          ) : (
            <div className="pi-grid">
              {visible.map((entry) => (
                <PreIpoCard
                  key={entry.company}
                  entry={entry}
                  onSelect={handleSelect}
                  isActive={selected?.company === entry.company}
                />
              ))}
            </div>
          )}
        </section>

        {selected && (
          <>
            <div className="pm-profile-backdrop" onClick={handleClose} aria-hidden="true" />
            <aside className="pm-profile-panel" aria-label={t('privateMarkets.profile.ariaLabel')}>
              <Suspense fallback={null}>
                <PreIpoProfile entry={selected} onClose={handleClose} />
              </Suspense>
            </aside>
          </>
        )}
      </div>
    </div>
  )
}
