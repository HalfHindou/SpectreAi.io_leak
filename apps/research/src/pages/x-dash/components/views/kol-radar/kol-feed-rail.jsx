/**
 * Live "New Follows" feed — the right rail.
 *
 * Each row: KOL avatar -> "@kol followed @target" with the project chip when
 * the followed account maps to a known token, a relative timestamp, and a
 * PRE-PUSH tag when the follow predates any mention. Newest first.
 *
 * Pure presentational — data + scope come from the parent (useKolFeed).
 */
import { useTranslation } from 'react-i18next'
import { Avatar, Shimmer, EmptyState, ErrorState } from '../../xd-bits'
import { relativeTime, formatNum } from '../../x-dash-utils'
import { tierMeta } from './kol-tier'
import SampleFollowBadge from './kol-sample-badge'

function FeedRow({ event, onOpenKol, onOpenProject }) {
  const { t } = useTranslation()
  const kol = event.kol || {}
  const target = event.target || {}
  const project = event.is_project ? (event.project || target.project) : null
  const targetHandle = String(target.screen_name || '').replace(/^@/, '')
  const kolHandle = String(kol.screen_name || '').replace(/^@/, '')
  const logo = project ? (project.image || project.image_small || project.image_url) : target.avatar_url
  const isPrePush = event.is_pre_push

  return (
    <li className="xd-kol-feedrow">
      <button
        type="button"
        className="xd-kol-feedrow__kol"
        onClick={() => onOpenKol && onOpenKol(kolHandle)}
        title={`@${kolHandle}`}
      >
        <Avatar src={kol.avatar_url} alt={kolHandle} size={30} />
      </button>
      <div className="xd-kol-feedrow__body">
        <p className="xd-kol-feedrow__line">
          <button type="button" className="xd-kol-feedrow__handle" onClick={() => onOpenKol && onOpenKol(kolHandle)}>@{kolHandle}</button>
          <span className="xd-kol-feedrow__verb">{t('kolRadar.feed.followed', 'followed')}</span>
          {project ? (
            <button
              type="button"
              className="xd-kol-feedrow__project"
              onClick={() => project.cg_id && onOpenProject && onOpenProject(project.cg_id)}
              disabled={!project.cg_id}
            >
              {logo
                ? <img className="xd-kol-feedrow__logo" src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                : <span className="xd-kol-feedrow__logo xd-kol-feedrow__logo--ph" aria-hidden="true" />}
              <span className="xd-num">{project.symbol ? `$${project.symbol}` : (project.name || `@${targetHandle}`)}</span>
            </button>
          ) : (
            <span className="xd-kol-feedrow__target">@{targetHandle}</span>
          )}
        </p>
        <div className="xd-kol-feedrow__meta">
          {isPrePush && <span className="xd-kol-feedrow__prepush">{t('kolRadar.feed.prePush', 'PRE-PUSH')}</span>}
          {kol.tier && (
            <span className={`xd-kol-tierbadge xd-kol-tierbadge--sm xd-kol-tierbadge--${tierMeta(kol.tier).cls}`}>
              {t(tierMeta(kol.tier).key, tierMeta(kol.tier).fallback)}
            </span>
          )}
          {kol.followers_count > 0 && (
            <span className="xd-kol-feedrow__sub xd-num">{formatNum(kol.followers_count)}</span>
          )}
          <span className="xd-kol-feedrow__time">{relativeTime(event.followed_at, t)}</span>
        </div>
      </div>
    </li>
  )
}

export default function KolFeedRail({
  events, loading, error, onRetry, scope, onOpenKol, onOpenProject, provider,
}) {
  const { t } = useTranslation()
  const list = Array.isArray(events) ? events : []
  const isSample = !provider || (provider !== 'twitterapiio' && provider !== 'socialdata' && provider !== 'tweetscout')

  return (
    <aside className="xd-kol-feed">
      <header className="xd-kol-feed__head">
        {/* only show the green "live" dot when the source is genuinely live */}
        {!isSample && <span className="xd-kol-feed__live" aria-hidden="true" />}
        <h3 className="xd-kol-feed__title">{t('kolRadar.feed.title', 'New Follows')}</h3>
        {isSample
          ? <SampleFollowBadge provider={provider} size="sm" />
          : (
            <span className="xd-kol-feed__scope">
              {scope === 'mine' ? t('kolRadar.scope.mine', 'My Radar') : t('kolRadar.scope.all', 'All KOLs')}
            </span>
          )}
      </header>

      {loading && list.length === 0 && <Shimmer variant="row" count={8} />}
      {error && list.length === 0 && <ErrorState message={error} onRetry={onRetry} />}

      {/* On mock we do NOT show fabricated "@X followed $Y" events — that's
          misleading. Show an honest not-connected state until a live source. */}
      {!loading && !error && isSample && (
        <EmptyState
          title={t('kolRadar.feed.notLive.title', 'Live follow tracking not connected')}
          detail={t('kolRadar.feed.notLive.detail', 'Real new-follow events will stream here once the follow data source is connected. The KOLs, tiers and track records above are live.')}
        />
      )}

      {!loading && !error && !isSample && list.length === 0 && (
        <EmptyState
          title={t('kolRadar.feed.empty.title', 'No new follows yet')}
          detail={scope === 'mine'
            ? t('kolRadar.feed.emptyMine.detail', 'When a KOL on your radar follows someone new, it lands here in real time.')
            : t('kolRadar.feed.empty.detail', 'New follows from tracked KOLs stream in here as they happen.')}
        />
      )}

      {!isSample && list.length > 0 && (
        <ul className="xd-kol-feed__list">
          {list.map((ev) => (
            <FeedRow
              key={ev.id}
              event={ev}
              onOpenKol={onOpenKol}
              onOpenProject={onOpenProject}
            />
          ))}
        </ul>
      )}
    </aside>
  )
}
