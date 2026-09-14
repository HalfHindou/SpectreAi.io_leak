/**
 * AcceleratorsFeed — Private Markets accelerators tab
 *
 * Shows YC + Hub71 companies in the same glass-card aesthetic as the deal feed.
 * Defaults to crypto-only filtering since Spectre is a crypto intelligence platform.
 * Search + batch + source filters. Click through to company website.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getAccelerators } from './private-markets-api'
import AcceleratorCard from './accelerator-card'
import DealFeedSkeleton from './deal-feed-skeleton'
import PmSelect from './pm-select'

const SOURCE_FILTERS = [
  { value: 'All Sources', labelKey: 'privateMarkets.accelerators.filters.allSources' },
  { value: 'YC',          labelKey: 'privateMarkets.accelerators.filters.yc' },
  { value: 'Hub71',       labelKey: 'privateMarkets.accelerators.filters.hub71' },
]

export default function AcceleratorsFeed() {
  const { t } = useTranslation()
  const [state, setState] = useState({ companies: [], total: 0, counts: {}, loading: true, error: null })
  const [cryptoOnly, setCryptoOnly] = useState(true)
  const [source, setSource] = useState('All Sources')
  const [search, setSearch] = useState('')

  const sourceOptions = useMemo(
    () => SOURCE_FILTERS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t]
  )

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const data = await getAccelerators({ cryptoOnly })
    setState({
      companies: data.companies,
      total: data.total,
      counts: data.counts || {},
      loading: false,
      error: data.unavailable ? 'unavailable' : null,
    })
  }, [cryptoOnly])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    let list = state.companies
    if (source !== 'All Sources') list = list.filter((c) => c.accelerator === source)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.oneLiner || '').toLowerCase().includes(q) ||
          (c.tags || []).some((t) => String(t).toLowerCase().includes(q))
      )
    }
    return list
  }, [state.companies, source, search])

  return (
    <section className="pm-accel-section" aria-label={t('privateMarkets.accelerators.feedAriaLabel')}>
      {/* Stats strip + filters */}
      <div className="pm-accel-toolbar glass-card">
        <div className="pm-accel-stats">
          <div className="pm-stat">
            <div className="caption">{t('privateMarkets.accelerators.stats.companies')}</div>
            <div className="pm-stat-value mono">{filtered.length}</div>
          </div>
          <div className="pm-stat">
            <div className="caption">{t('privateMarkets.accelerators.stats.yc')}</div>
            <div className="pm-stat-value mono">{state.counts.yc || 0}</div>
          </div>
          <div className="pm-stat">
            <div className="caption">{t('privateMarkets.accelerators.stats.hub71')}</div>
            <div className="pm-stat-value mono">{state.counts.hub71 || 0}</div>
          </div>
        </div>
        <div className="pm-accel-controls">
          <label className="pm-accel-toggle">
            <input
              type="checkbox"
              checked={cryptoOnly}
              onChange={(e) => setCryptoOnly(e.target.checked)}
            />
            <span className="pm-accel-toggle-label">{t('privateMarkets.accelerators.filters.cryptoOnly')}</span>
          </label>
          <PmSelect
            className="pm-accel-select"
            value={source}
            options={sourceOptions}
            onChange={setSource}
            ariaLabel={t('privateMarkets.accelerators.filters.sourceAriaLabel')}
          />
          <input
            type="text"
            className="pm-accel-search"
            placeholder={t('privateMarkets.accelerators.filters.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('privateMarkets.accelerators.filters.searchAriaLabel')}
          />
        </div>
      </div>

      {/* Feed */}
      {state.loading && <DealFeedSkeleton />}
      {!state.loading && state.error && (
        <div className="pm-empty glass-card">
          <div className="pm-empty-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </div>
          <h3 className="display-sm">{t('privateMarkets.accelerators.error.unavailableTitle')}</h3>
          <p className="body pm-empty-message">
            {t('privateMarkets.accelerators.error.unavailableMessage')}
          </p>
        </div>
      )}
      {!state.loading && !state.error && filtered.length === 0 && (
        <div className="pm-empty glass-card">
          <div className="pm-empty-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 18v4M16.24 16.24l2.83 2.83M18 12h4M16.24 7.76l2.83-2.83" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </div>
          <h3 className="display-sm">{t('privateMarkets.accelerators.empty.noMatchTitle')}</h3>
          <p className="body pm-empty-message">
            {t('privateMarkets.accelerators.empty.noMatchMessage')}
          </p>
        </div>
      )}
      {!state.loading && !state.error && filtered.length > 0 && (
        <div className="pm-feed-grid">
          {filtered.map((company) => (
            <AcceleratorCard key={company.id} company={company} />
          ))}
        </div>
      )}
    </section>
  )
}
