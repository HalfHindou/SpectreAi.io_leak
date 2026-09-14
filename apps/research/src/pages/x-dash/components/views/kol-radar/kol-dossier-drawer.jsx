/**
 * KOL dossier drawer. Slides in from the right, mirrors xd-author-drawer's
 * scaffold: portaled to document.body (escapes the page-layout transform
 * containing block), day-mode + nav-offset flags mirrored on the portal
 * wrapper, Escape-to-close, shimmer loading.
 *
 * Driven by useKolDossier(handle):
 *   { kol, recent_follows:[FollowEvent], pushes:[], following_sample:[Account],
 *     stats:{following_tracked,new_follows_7d,projects_followed} }
 *
 * Sections: profile header (avatar, tier, verified, followers, follow star) ->
 * stats row -> their recent new-follows (feed-row styling) -> projects-followed
 * chips -> mini follow-network graph.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import { useKolDossier } from '@/hooks/useKolDossier'
import { Avatar, VerifiedTick, Shimmer, ErrorState } from '../../xd-bits'
import { formatNum, relativeTime } from '../../x-dash-utils'
import { tierMeta } from './kol-tier'
import { archetypeMeta, gradeTone, isBuilding } from './kol-archetype'
import KolFollowNetwork from './kol-follow-network'
import SampleFollowBadge from './kol-sample-badge'
import KolEndorsementBubbles from './kol-endorsement-bubbles'
import KolCallLedger from './kol-call-ledger'

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)
const XLogoIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
const StarIcon = ({ filled }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
  </svg>
)

function FollowRow({ event, onOpenProject }) {
  const { t } = useTranslation()
  const target = event.target || {}
  const project = event.is_project ? (event.project || target.project) : null
  const targetHandle = String(target.screen_name || '').replace(/^@/, '')
  const logo = project ? (project.image || project.image_small || project.image_url) : target.avatar_url

  return (
    <li className="xd-kol-feedrow xd-kol-feedrow--compact">
      <span className="xd-kol-feedrow__kol xd-kol-feedrow__kol--static">
        {project ? (
          logo
            ? <img className="xd-kol-feedrow__logo" src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            : <span className="xd-kol-feedrow__logo xd-kol-feedrow__logo--ph" aria-hidden="true" />
        ) : (
          <Avatar src={target.avatar_url} alt={targetHandle} size={30} />
        )}
      </span>
      <div className="xd-kol-feedrow__body">
        <p className="xd-kol-feedrow__line">
          <span className="xd-kol-feedrow__verb">{t('kolRadar.feed.followed', 'followed')}</span>
          {project ? (
            <button
              type="button"
              className="xd-kol-feedrow__project"
              onClick={() => project.cg_id && onOpenProject && onOpenProject(project.cg_id)}
              disabled={!project.cg_id}
            >
              <span className="xd-num">{project.symbol ? `$${project.symbol}` : (project.name || `@${targetHandle}`)}</span>
            </button>
          ) : (
            <span className="xd-kol-feedrow__target">@{targetHandle}</span>
          )}
        </p>
        <div className="xd-kol-feedrow__meta">
          {event.is_pre_push && <span className="xd-kol-feedrow__prepush">{t('kolRadar.feed.prePush', 'PRE-PUSH')}</span>}
          <span className="xd-kol-feedrow__time">{relativeTime(event.followed_at, t)}</span>
        </div>
      </div>
    </li>
  )
}

/* Archetype chip tone by score band — Sharp (green) → Mixed (amber) →
   Degen / Exit Liquidity (red) → Unrated (muted). Mirrors computeLegitimacy's
   label thresholds so the chip color matches the word. */
function legitBand(score) {
  if (score == null) return 'unrated'
  if (score >= 70) return 'sharp'
  if (score >= 45) return 'mixed'
  return 'degen'
}

/* Legitimacy header block — a score ring (color by band), the archetype chip,
   and an "N alive · N cooling · N dead" breakdown. Drives from the dossier's
   legitimacy block. The ring mirrors the SignalScore ring pattern. */
function LegitimacyRing({ score, band }) {
  const pct = Math.max(0, Math.min(100, Number(score || 0)))
  const R = 22
  const C = 2 * Math.PI * R
  const dash = (pct / 100) * C
  return (
    <div className={`xd-kol-legit__ring xd-kol-legit__ring--${band}`}>
      <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
        <circle className="xd-kol-legit__ring-track" cx="29" cy="29" r={R} fill="none" strokeWidth="4" />
        <circle
          className="xd-kol-legit__ring-fill"
          cx="29" cy="29" r={R} fill="none" strokeWidth="4"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          transform="rotate(-90 29 29)"
        />
      </svg>
      <span className="xd-kol-legit__ring-num xd-num">{score == null ? '—' : Math.round(pct)}</span>
    </div>
  )
}

function LegitimacyBlock({ legitimacy, endorsements, onOpenProject, t }) {
  const legit = legitimacy || {}
  const label = legit.label || t('kolRadar.legit.unrated', 'Unrated')
  // thin/unrated legitimacy must read NEUTRAL (grey), never a damning red score.
  const legitThin = label === 'Building' || label === 'Unrated' || legit.sample === 'limited'
  const hasScore = legit.score != null && !legitThin
  const score = hasScore ? Math.round(Number(legit.score)) : null
  const band = legitThin ? 'unrated' : legitBand(score)
  const alive = Number(legit.alive || 0)
  const cooling = Number(legit.cooling || 0)
  const dead = Number(legit.dead || 0)
  const hasBreakdown = alive + cooling + dead > 0

  return (
    <section className="xd-kol-dossier__section xd-kol-legit">
      <div className="xd-drawer-section__label">{t('kolRadar.legit.title', 'Legitimacy')}</div>

      <div className="xd-kol-legit__head">
        <LegitimacyRing score={score} band={band} />
        <div className="xd-kol-legit__head-text">
          <span className={`xd-kol-legit__archetype xd-kol-legit__archetype--${band}`}>{label}</span>
          {hasBreakdown ? (
            <div className="xd-kol-legit__breakdown">
              <span className="xd-kol-legit__bd xd-kol-legit__bd--green">
                <b className="xd-num">{alive}</b> {t('kolRadar.health.alive', 'alive')}
              </span>
              <span className="xd-kol-legit__bd-sep" aria-hidden="true">·</span>
              <span className="xd-kol-legit__bd xd-kol-legit__bd--amber">
                <b className="xd-num">{cooling}</b> {t('kolRadar.health.cooling', 'cooling')}
              </span>
              <span className="xd-kol-legit__bd-sep" aria-hidden="true">·</span>
              <span className="xd-kol-legit__bd xd-kol-legit__bd--red">
                <b className="xd-num">{dead}</b> {t('kolRadar.health.dead', 'dead')}
              </span>
            </div>
          ) : (
            <span className="xd-kol-legit__none">
              {t('kolRadar.legit.noData', 'Not enough rated endorsements to score yet.')}
            </span>
          )}
        </div>
      </div>

      <KolEndorsementBubbles endorsements={endorsements} onOpenProject={onOpenProject} />
    </section>
  )
}

export default function KolDossierDrawer({
  handle, onClose, isFollowing, onToggleFollow, onOpenProject, onOpenKol,
}) {
  const { t } = useTranslation()
  /* Day mode + nav-sidebar state live on .app root, but the drawer is portaled
     to document.body so descendant selectors miss. Mirror both flags on the
     portal wrapper so day-mode CSS still fires — same pattern as the author
     drawer. */
  const dayMode = useSettingsStore((s) => s.dayMode)
  const navSidebarCollapsed = useSettingsStore((s) => s.navSidebarCollapsed)
  const navigate = useNavigate()
  const { data, loading, error, refetch } = useKolDossier(handle)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  // The backend now resolves arbitrary handles; if it can't, it returns
  // { found:false, handle } with a 200 so we render a graceful empty state
  // rather than an error.
  const notFound = data != null && data.found === false
  const kol = data?.kol || {}
  const cleanHandle = String(kol.screen_name || data?.handle || handle || '').replace(/^@/, '')
  const tier = tierMeta(kol.tier)
  const verified = kol.verified
  const tracked = isFollowing ? isFollowing(cleanHandle) : false
  const recentFollows = Array.isArray(data?.recent_follows) ? data.recent_follows : []
  const pushes = Array.isArray(data?.pushes) ? data.pushes : []
  const followingSample = Array.isArray(data?.following_sample) ? data.following_sample : []
  const endorsements = Array.isArray(data?.endorsements) ? data.endorsements : []
  const legitimacy = data?.legitimacy || null
  const stats = data?.stats || {}
  const xUrl = cleanHandle ? `https://x.com/${cleanHandle}` : null

  const trackRecord = data?.track_record || null
  const credibility = data?.credibility || null
  const archetype = data?.archetype || null
  const building = isBuilding({ trackRecord, credibility })
  const archMeta = archetypeMeta(building ? 'building' : archetype)
  const grade = credibility?.grade || '—'
  const gTone = building ? 'neutral' : gradeTone(grade)
  const hasTrackRecord = Boolean(trackRecord)

  const portalClass = [
    'app',
    'nav-sidebar-open',
    navSidebarCollapsed ? 'nav-sidebar-collapsed' : '',
    dayMode ? 'app-day-mode' : '',
  ].filter(Boolean).join(' ')

  return createPortal(
    <div className={portalClass}>
      <div className="xd-drawer-scrim" onClick={onClose} />
      <aside
        className="xd-drawer xd-drawer--kol"
        role="dialog"
        aria-label={t('kolRadar.dossier.aria', '@{{handle}} dossier', { handle: cleanHandle })}
      >
        {/* HEADER — profile */}
        <header className="xd-kol-dossier__hero">
          <div className="xd-kol-dossier__hero-actions">
            {cleanHandle && (
              <button
                type="button"
                className="xd-kol-dossier__expand"
                onClick={() => { onClose(); navigate(`/x-dash/kol/${encodeURIComponent(cleanHandle)}`) }}
                aria-label={t('kolRadar.dossier.expand', 'Open full profile')}
                title={t('kolRadar.dossier.expand', 'Open full profile')}
              >
                <ExpandIcon />
                <span className="xd-kol-dossier__expand-label">{t('kolRadar.dossier.fullProfile', 'Full profile')}</span>
              </button>
            )}
            <button
              type="button"
              className="xd-kol-dossier__close"
              onClick={onClose}
              aria-label={t('kolRadar.dossier.close', 'Close')}
            >
              <CloseIcon />
            </button>
          </div>

          {loading && !data ? (
            <div className="xd-kol-dossier__head">
              <div className="xd-shimmer-avatar xd-shimmer-avatar--lg animate-shimmer" />
              <div className="xd-kol-dossier__head-text">
                <div className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" style={{ maxWidth: 160 }} />
                <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 8, maxWidth: 110 }} />
              </div>
            </div>
          ) : (
            <div className="xd-kol-dossier__head">
              <span className={`xd-kol-dossier__avatar xd-kol-dossier__avatar--${tier.cls}`}>
                <Avatar src={kol.avatar_url} alt={cleanHandle} size={56} />
                {verified && <span className="xd-kol-dossier__tick"><VerifiedTick size={13} /></span>}
              </span>
              <div className="xd-kol-dossier__head-text">
                <div className="xd-kol-dossier__name-row">
                  <h2 className="xd-kol-dossier__name">{kol.name || `@${cleanHandle}`}</h2>
                </div>
                <div className="xd-kol-dossier__handle-row">
                  {xUrl ? (
                    <a href={xUrl} target="_blank" rel="noopener noreferrer" className="xd-kol-dossier__handle">
                      @{cleanHandle}<XLogoIcon />
                    </a>
                  ) : (
                    <span className="xd-kol-dossier__handle">@{cleanHandle}</span>
                  )}
                  <span className={`xd-kol-tierbadge xd-kol-tierbadge--${tier.cls}`}>{t(tier.key, tier.fallback)}</span>
                  {hasTrackRecord && (
                    <>
                      <span
                        className={`kcl-grade kcl-grade--sm kcl-grade--${gTone}`}
                        title={building
                          ? t('kolRadar.ledger.gradePending', 'Credibility grade pending — still building a track record')
                          : t('kolRadar.ledger.gradeTip', 'Credibility grade from realized, market-fair call performance')}
                      >
                        <span className="kcl-grade__letter xd-num">{building ? '—' : grade}</span>
                      </span>
                      <span className={`kcl-chip kcl-chip--${archMeta.cls}`}>
                        {t(archMeta.key, archMeta.fallback)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={`xd-kol-star xd-kol-dossier__star${tracked ? ' xd-kol-star--on' : ''}`}
                onClick={() => onToggleFollow && onToggleFollow(cleanHandle)}
                aria-pressed={tracked}
                title={tracked ? t('kolRadar.card.tracking', 'Tracking — remove from My Radar') : t('kolRadar.card.track', 'Add to My Radar')}
              >
                <StarIcon filled={tracked} />
              </button>
            </div>
          )}
        </header>

        <div className="xd-drawer__body xd-kol-dossier__body">
          {error && <ErrorState message={error} onRetry={refetch} />}
          {loading && !data && <Shimmer variant="drawer" count={5} />}

          {notFound && (
            <div className="xd-kol-dossier__notfound">
              <p className="xd-kol-dossier__notfound-title">
                {t('kolRadar.dossier.notFound.title', 'Not enough data on @{{handle}} yet', { handle: cleanHandle })}
              </p>
              <p className="xd-kol-dossier__notfound-detail">
                {t('kolRadar.dossier.notFound.detail', 'We don\'t track this account yet — once it shows up in the follow graph, its dossier and legitimacy will fill in here.')}
              </p>
            </div>
          )}

          {data && !notFound && (
            <>
              {/* CALL LEDGER — the receipts (compact). The new headline of the dossier. */}
              {hasTrackRecord && (
                <section className="xd-kol-dossier__section xd-kol-dossier__ledger">
                  <KolCallLedger
                    trackRecord={trackRecord}
                    archetype={archetype}
                    credibility={credibility}
                    compact
                  />
                </section>
              )}

              {/* LEGITIMACY — score ring + archetype + endorsement bubbles */}
              <LegitimacyBlock
                legitimacy={legitimacy}
                endorsements={endorsements}
                onOpenProject={onOpenProject}
                t={t}
              />

              {/* STATS ROW */}
              <div className="xd-kol-dossier__stats">
                <div className="xd-kol-dossier__stat">
                  <span className="xd-kol-dossier__stat-value xd-num">{formatNum(kol.followers_count)}</span>
                  <span className="xd-kol-dossier__stat-label">{t('kolRadar.followers', 'followers')}</span>
                </div>
                <div className="xd-kol-dossier__stat">
                  <span className="xd-kol-dossier__stat-value xd-num">{formatNum(stats.following_tracked || followingSample.length)}</span>
                  <span className="xd-kol-dossier__stat-label">{t('kolRadar.dossier.tracked', 'tracked')}</span>
                </div>
                <div className="xd-kol-dossier__stat">
                  <span className="xd-kol-dossier__stat-value xd-num">{formatNum(stats.new_follows_7d || 0)}</span>
                  <span className="xd-kol-dossier__stat-label">{t('kolRadar.dossier.newFollows7d', 'new · 7d')}</span>
                </div>
                <div className="xd-kol-dossier__stat">
                  <span className="xd-kol-dossier__stat-value xd-num">{formatNum(stats.projects_followed || 0)}</span>
                  <span className="xd-kol-dossier__stat-label">{t('kolRadar.dossier.projects', 'projects')}</span>
                </div>
              </div>

              {/* FOLLOW NETWORK — mini radial graph */}
              <section className="xd-kol-dossier__section">
                <div className="xd-drawer-section__label">{t('kolRadar.dossier.network', 'Follow network')}<SampleFollowBadge provider={data?.provider} size="sm" /></div>
                {['twitterapiio', 'socialdata', 'tweetscout'].includes(data?.provider) ? (
                  <KolFollowNetwork kol={kol} accounts={followingSample} onOpenProject={onOpenProject} />
                ) : (
                  <p className="xd-kol-dossier__empty">{t('kolRadar.feed.notLive.detail', 'This maps who the KOL follows — it fills in once the follow data source is connected.')}</p>
                )}
              </section>

              {/* PROJECTS FOLLOWED — chips */}
              {pushes.length > 0 && (
                <section className="xd-kol-dossier__section">
                  <div className="xd-drawer-section__label">{t('kolRadar.dossier.pushes', 'Projects followed')}</div>
                  <div className="xd-kol-dossier__chips">
                    {pushes.filter((p) => p && (p.symbol || p.name)).slice(0, 12).map((p, i) => (
                      <button
                        type="button"
                        key={p.cg_id || p.symbol || i}
                        className="xd-kol-dossier__chip"
                        onClick={() => p.cg_id && onOpenProject && onOpenProject(p.cg_id)}
                        disabled={!p.cg_id}
                        title={p.name || p.symbol}
                      >
                        {(p.image || p.image_small || p.image_url)
                          ? <img className="xd-kol-dossier__chip-logo" src={p.image || p.image_small || p.image_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                          : <span className="xd-kol-dossier__chip-logo xd-kol-dossier__chip-logo--ph" aria-hidden="true" />}
                        <span className="xd-num">{p.symbol ? `$${p.symbol}` : p.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* RECENT NEW FOLLOWS */}
              <section className="xd-kol-dossier__section">
                <div className="xd-drawer-section__label">{t('kolRadar.dossier.recentFollows', 'Recent new follows')}<SampleFollowBadge provider={data?.provider} size="sm" /></div>
                {!['twitterapiio', 'socialdata', 'tweetscout'].includes(data?.provider) ? (
                  <p className="xd-kol-dossier__empty">{t('kolRadar.feed.notLive.detail', 'Real new-follow events will stream here once the follow data source is connected.')}</p>
                ) : recentFollows.length > 0 ? (
                  <ul className="xd-kol-feed__list">
                    {recentFollows.slice(0, 20).map((ev) => (
                      <FollowRow key={ev.id} event={ev} onOpenProject={onOpenProject} />
                    ))}
                  </ul>
                ) : (
                  <p className="xd-kol-dossier__empty">{t('kolRadar.dossier.noFollows', 'No new follows tracked yet for this KOL.')}</p>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
