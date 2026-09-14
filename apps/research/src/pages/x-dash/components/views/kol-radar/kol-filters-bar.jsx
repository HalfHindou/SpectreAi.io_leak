/**
 * KOL DB filters bar — search + tier / narrative / sort dropdowns, plus the
 * "My Radar vs All" scope toggle that drives scope=mine across the view.
 * Reuses the XDDropdown primitive + the command-bar search styling.
 */
import { useTranslation } from 'react-i18next'
import { XDDropdown } from '../../xd-bits'
import { TIER_FILTERS } from './kol-tier'

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

export default function KolFiltersBar({
  scope, onScope, followCount,
  query, onQueryChange,
  tier, onTier, narrative, onNarrative, sort, onSort,
  narrativeOptions = [],
  bigGunsRemaining = 0, onFollowBigGuns,
}) {
  const { t } = useTranslation()

  const TIERS = TIER_FILTERS.map((o) => ({ key: o.key, label: t(`kolRadar.filters.tier.${o.key}`, o.fallback) }))

  const SORTS = [
    { key: 'influence', label: t('kolRadar.filters.sort.influence', 'Influence') },
    { key: 'activity', label: t('kolRadar.filters.sort.activity', 'Activity') },
    { key: 'new_follows', label: t('kolRadar.filters.sort.newFollows', 'New follows') },
    { key: 'followers', label: t('kolRadar.filters.sort.followers', 'Followers') },
    { key: 'legit', label: t('kolRadar.filters.sort.legit', 'Legit score') },
  ]

  const NARRATIVES = [
    { key: 'all', label: t('kolRadar.filters.narrative.all', 'All narratives') },
    ...narrativeOptions.map((n) => ({ key: n.key, label: n.label })),
  ]

  return (
    <div className="xd-kol-filters">
      <div className="xd-kol-scope" role="tablist" aria-label={t('kolRadar.scope.aria', 'Radar scope')}>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'all'}
          className={`xd-kol-scope__btn${scope === 'all' ? ' xd-kol-scope__btn--active' : ''}`}
          onClick={() => onScope('all')}
        >
          {t('kolRadar.scope.all', 'All KOLs')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'mine'}
          className={`xd-kol-scope__btn${scope === 'mine' ? ' xd-kol-scope__btn--active' : ''}`}
          onClick={() => onScope('mine')}
        >
          {t('kolRadar.scope.mine', 'My Radar')}
          {followCount > 0 && <span className="xd-kol-scope__count xd-num">{followCount}</span>}
        </button>
      </div>

      {/* One-click starter pack: follow the proven big guns (Ansem,
          IncomeSharks, CryptoWizardd, …) that aren't followed yet. Hidden
          once the whole pack is on the radar. */}
      {bigGunsRemaining > 0 && onFollowBigGuns && (
        <button
          type="button"
          className="xd-kol-bigguns"
          onClick={onFollowBigGuns}
          title={t('kolRadar.bigGuns.tip', 'Follow the proven top callers — Ansem, IncomeSharks, CryptoWizardd and the rest of the S-tier pack')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.9 6.26L21.5 9.3l-4.75 4.36L17.9 20.5 12 17.1 6.1 20.5l1.15-6.84L2.5 9.3l6.6-1.04L12 2z" />
          </svg>
          {t('kolRadar.bigGuns.cta', 'Follow the big guns')}
          <span className="xd-kol-bigguns__count xd-num">+{bigGunsRemaining}</span>
        </button>
      )}

      <div className="xd-kol-search">
        <span className="xd-kol-search__icon"><SearchIcon /></span>
        <input
          className="xd-kol-search__input"
          placeholder={t('kolRadar.filters.searchPlaceholder', 'Search handle or name')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      <div className="xd-kol-filters__dropdowns">
        <XDDropdown
          options={TIERS}
          value={tier}
          onChange={onTier}
          ariaLabel={t('kolRadar.filters.tier.aria', 'Tier filter')}
          minWidth={150}
        />
        <XDDropdown
          options={NARRATIVES}
          value={narrative}
          onChange={onNarrative}
          ariaLabel={t('kolRadar.filters.narrative.aria', 'Narrative filter')}
          minWidth={170}
        />
        <XDDropdown
          options={SORTS}
          value={sort}
          onChange={onSort}
          ariaLabel={t('kolRadar.filters.sort.aria', 'Sort by')}
          minWidth={150}
        />
      </div>
    </div>
  )
}
