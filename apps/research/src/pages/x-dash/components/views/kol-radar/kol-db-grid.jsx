/**
 * Giga KOL DB grid — the dense card wall + pagination. Pure presentational:
 * the parent owns the useKolDb data + the follow set. Renders shimmer cards
 * while loading, a scope-aware empty state, and an error state with retry.
 */
import { useTranslation } from 'react-i18next'
import { Shimmer, EmptyState, ErrorState, Pagination } from '../../xd-bits'
import KolCard from './kol-card'

export default function KolDbGrid({
  kols, pagination, loading, error, onRetry,
  scope, isFollowing, onToggleFollow, onOpen, onOpenProject,
  page, perPage, onPage, onPerPage,
}) {
  const { t } = useTranslation()
  const list = Array.isArray(kols) ? kols : []

  if (loading && list.length === 0) {
    return (
      <div className="xd-kol-grid xd-kol-grid--loading">
        {Array.from({ length: 9 }).map((_, i) => (
          <div className="xd-kol-card xd-kol-card--loading" key={i}>
            <Shimmer variant="card" count={1} />
          </div>
        ))}
      </div>
    )
  }

  if (error && list.length === 0) {
    return <ErrorState message={error} onRetry={onRetry} />
  }

  if (!loading && list.length === 0) {
    return (
      <EmptyState
        title={scope === 'mine'
          ? t('kolRadar.db.emptyMine.title', "You're not tracking any KOLs yet")
          : t('kolRadar.db.empty.title', 'No KOLs match these filters')}
        detail={scope === 'mine'
          ? t('kolRadar.db.emptyMine.detail', 'Star a KOL anywhere in the database to build your radar — then convergence on their new follows alerts you first.')
          : t('kolRadar.db.empty.detail', 'Try a different tier, narrative, or clear the search.')}
      />
    )
  }

  return (
    <>
      <div className="xd-kol-grid">
        {list.map((kol) => (
          <KolCard
            key={kol.id || kol.screen_name}
            kol={kol}
            tracked={isFollowing(kol.screen_name)}
            onToggleFollow={onToggleFollow}
            onOpen={onOpen}
            onOpenProject={onOpenProject}
          />
        ))}
      </div>
      <Pagination
        page={pagination?.page || page}
        pageCount={pagination?.page_count || 1}
        onPage={onPage}
        perPage={perPage}
        onPerPage={onPerPage}
        perPageOptions={[30, 60, 90]}
      />
    </>
  )
}
