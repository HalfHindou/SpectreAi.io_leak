/**
 * KOL PROFILE PAGE — the full-screen KOL profile (vs the in-grid dossier drawer).
 *
 * Reached at /x-dash/kol/:handle (routed via App.jsx → XDashPage). An immersive,
 * full-width profile: a rich hero band (avatar + tier + archetype/grade + stat
 * tiles incl. combined endorsed market cap), then the CENTERPIECE — a large,
 * drifting bubble field of every project they endorse (size = market cap, fill =
 * health, hover = market cap + 24h/7d + ATH drawdown + their tracked call) — then
 * an asymmetric body grid: Call Ledger receipts + market-cap-aware Projects-
 * Followed chips on the left, Legitimacy ring + Follow Network + Recent Follows
 * on the right. Fills the page left→right (max 2000px); stacks on mobile.
 *
 * Driven by useKolDossier(handle). The bubble field is its own immersive
 * component (kol-project-bubbles); the follow-network + call-ledger are shared
 * with the dossier drawer so the page never drifts. Day-mode + mobile live in
 * the paired css files (kpp- prefix; bubbles use kpb-).
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useKolDossier } from '@/hooks/useKolDossier'
import { useKolFollows } from '@/hooks/useKolFollows'
import { Avatar, VerifiedTick, Shimmer, ErrorState } from '../../xd-bits'
import { formatNum, relativeTime, fmtUsd } from '../../x-dash-utils'
import { tierMeta } from './kol-tier'
import { archetypeMeta, gradeTone, isBuilding } from './kol-archetype'
import KolFollowNetwork from './kol-follow-network'
import SampleFollowBadge from './kol-sample-badge'
import KolProjectBubbles from './kol-project-bubbles'
import KolCallLedger from './kol-call-ledger'
import './kpp-kol-profile.css'
import './kpp-kol-profile.day-mode.css'
import './kpp-kol-profile.mobile.css'

const BackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)
const XLogoIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
const StarIcon = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
  </svg>
)

/* Archetype tone band — mirrors the drawer's legitimacy thresholds so the chip
   color matches the word. >=70 sharp (green) · 45-69 mixed (amber) · <45 degen
   (red) · null unrated (muted). */
function legitBand(score) {
  if (score == null) return 'unrated'
  if (score >= 70) return 'sharp'
  if (score >= 45) return 'mixed'
  return 'degen'
}

/* Legit score ring — bigger sibling of the drawer's LegitimacyRing. */
function LegitRing({ score, band, size = 96 }) {
  const pct = Math.max(0, Math.min(100, Number(score || 0)))
  const R = size / 2 - 7
  const C = 2 * Math.PI * R
  const dash = (pct / 100) * C
  const c = size / 2
  return (
    <div className={`kpp-legit__ring kpp-legit__ring--${band}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="kpp-legit__ring-track" cx={c} cy={c} r={R} fill="none" strokeWidth="6" />
        <circle
          className="kpp-legit__ring-fill"
          cx={c} cy={c} r={R} fill="none" strokeWidth="6"
          strokeDasharray={`${dash} ${C}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <span className="kpp-legit__ring-num xd-num">{score == null ? '—' : Math.round(pct)}</span>
    </div>
  )
}

/* signed change → "+2.3%" / "−1.8%". */
function fmtChange(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toFixed(1)}%`
}
function changeTone(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}

/* Recent-new-follow row — mirrors the drawer's FollowRow, project-aware, now
   surfacing the followed project's market cap + 24h change when available. */
function FollowRow({ event, onOpenProject, t }) {
  const target = event.target || {}
  const project = event.is_project ? (event.project || target.project) : null
  const targetHandle = String(target.screen_name || '').replace(/^@/, '')
  const logo = project ? (project.image || project.image_small || project.image_url) : target.avatar_url
  const mc = project ? fmtUsd(project.market_cap ?? project.health?.market_cap) : null
  const ch = project ? fmtChange(project.change24h ?? project.health?.change24h) : null

  return (
    <li className="kpp-followrow">
      <span className="kpp-followrow__logo-wrap">
        {project ? (
          logo
            ? <img className="kpp-followrow__logo" src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            : <span className="kpp-followrow__logo kpp-followrow__logo--ph" aria-hidden="true" />
        ) : (
          <Avatar src={target.avatar_url} alt={targetHandle} size={30} />
        )}
      </span>
      <div className="kpp-followrow__body">
        <p className="kpp-followrow__line">
          <span className="kpp-followrow__verb">{t('kolRadar.feed.followed', 'followed')}</span>
          {project ? (
            <button
              type="button"
              className="kpp-followrow__project"
              onClick={() => project.cg_id && onOpenProject && onOpenProject(project.cg_id)}
              disabled={!project.cg_id}
            >
              <span className="xd-num">{project.symbol ? `$${project.symbol}` : (project.name || `@${targetHandle}`)}</span>
            </button>
          ) : (
            <span className="kpp-followrow__target">@{targetHandle}</span>
          )}
          {mc && <span className="kpp-followrow__mc xd-num">{mc}</span>}
          {ch && <span className={`kpp-followrow__ch xd-num kpp-followrow__ch--${changeTone(project.change24h ?? project.health?.change24h)}`}>{ch}</span>}
        </p>
        <div className="kpp-followrow__meta">
          {event.is_pre_push && <span className="kpp-followrow__prepush">{t('kolRadar.feed.prePush', 'PRE-PUSH')}</span>}
          <span className="kpp-followrow__time">{relativeTime(event.followed_at, t)}</span>
        </div>
      </div>
    </li>
  )
}

/* Project chip — logo + $SYM + compact market cap + 24h change indicator. Used
   for the "Projects followed" wall, now market-cap-aware (the data is on the
   push's health block). */
function ProjectChip({ project, onOpenProject }) {
  const logo = project.image || project.image_small || project.image_url
  const mc = fmtUsd(project.market_cap ?? project.health?.market_cap)
  const ch24 = project.change24h ?? project.health?.change24h
  const ch = fmtChange(ch24)
  return (
    <button
      type="button"
      className="kpp-chip"
      onClick={() => project.cg_id && onOpenProject && onOpenProject(project.cg_id)}
      disabled={!project.cg_id}
      title={project.name || project.symbol}
    >
      {logo
        ? <img className="kpp-chip__logo" src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        : <span className="kpp-chip__logo kpp-chip__logo--ph" aria-hidden="true" />}
      <span className="kpp-chip__sym xd-num">{project.symbol ? `$${project.symbol}` : project.name}</span>
      {mc && <span className="kpp-chip__mc xd-num">{mc}</span>}
      {ch && <span className={`kpp-chip__ch xd-num kpp-chip__ch--${changeTone(ch24)}`}>{ch}</span>}
    </button>
  )
}

export default function KolProfilePage({ handle, onOpenProject }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, loading, error, refetch } = useKolDossier(handle)
  const { isFollowing, toggleFollow } = useKolFollows()

  /* Project chips/targets open the X Dash token drawer. The page route can pass
     its own opener (onOpenProject); fall back to navigating directly. */
  const openProject = useCallback((cgId) => {
    if (!cgId) return
    if (onOpenProject) { onOpenProject(cgId); return }
    navigate(`/x-dash/token/${encodeURIComponent(cgId)}`)
  }, [onOpenProject, navigate])

  const goBack = useCallback(() => navigate('/x-dash/kol-radar'), [navigate])

  const notFound = data != null && data.found === false
  const kol = data?.kol || {}
  const cleanHandle = String(kol.screen_name || data?.handle || handle || '').replace(/^@/, '')
  const tier = tierMeta(kol.tier)
  const verified = kol.verified
  const tracked = isFollowing ? isFollowing(cleanHandle) : false

  const recentFollows = Array.isArray(data?.recent_follows) ? data.recent_follows : []
  // follow graph is sample (fabricated) until a live provider is connected — we
  // do NOT show invented "@X followed $Y" events; show an honest not-connected state.
  const followLive = ['twitterapiio', 'socialdata', 'tweetscout'].includes(data?.provider)
  const pushes = Array.isArray(data?.pushes) ? data.pushes : []
  const followingSample = Array.isArray(data?.following_sample) ? data.following_sample : []
  const endorsements = Array.isArray(data?.endorsements) ? data.endorsements : []
  const legitimacy = data?.legitimacy || null
  const stats = data?.stats || {}
  const xUrl = cleanHandle ? `https://x.com/${cleanHandle}` : null

  const trackRecord = data?.track_record || null
  const calls = Array.isArray(trackRecord?.calls) ? trackRecord.calls : []
  const credibility = data?.credibility || null
  const archetype = data?.archetype || null

  /* combined tracked market cap across endorsements — a real "what they touch"
     headline number for the hero. */
  const totalEndorsedCap = endorsements.reduce((sum, e) => {
    const mc = Number(e?.health?.market_cap)
    return sum + (Number.isFinite(mc) && mc > 0 ? mc : 0)
  }, 0)
  const endorsedCapStr = totalEndorsedCap > 0 ? fmtUsd(totalEndorsedCap) : null
  const building = isBuilding({ trackRecord, credibility })
  const archMeta = archetypeMeta(building ? 'building' : archetype)
  const grade = credibility?.grade || '—'
  const gTone = building ? 'neutral' : gradeTone(grade)
  const hasTrackRecord = Boolean(trackRecord)

  const legitLabel = legitimacy?.label || t('kolRadar.legit.unrated', 'Unrated')
  // thin/unrated legitimacy must read NEUTRAL (grey), never a damning red score.
  const legitThin = legitLabel === 'Building' || legitLabel === 'Unrated' || legitimacy?.sample === 'limited'
  const hasScore = legitimacy && legitimacy.score != null && !legitThin
  const legitScore = hasScore ? Math.round(Number(legitimacy.score)) : null
  const band = legitThin ? 'unrated' : legitBand(legitScore)
  const alive = Number(legitimacy?.alive || 0)
  const cooling = Number(legitimacy?.cooling || 0)
  const dead = Number(legitimacy?.dead || 0)
  const hasBreakdown = alive + cooling + dead > 0

  const isLoading = loading && !data

  return (
    <div className="kpp">
      <div className="kpp-topbar">
        <button type="button" className="kpp-back" onClick={goBack}>
          <BackIcon />
          <span>{t('kolRadar.profile.back', 'KOL Radar')}</span>
        </button>
      </div>

      {/* HERO HEADER */}
      <header className="kpp-hero">
        {isLoading ? (
          <div className="kpp-hero__inner">
            <div className="kpp-shimmer-avatar animate-shimmer" />
            <div className="kpp-hero__id">
              <div className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" style={{ maxWidth: 220 }} />
              <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 10, maxWidth: 140 }} />
            </div>
          </div>
        ) : (
          <div className="kpp-hero__inner">
            <span className={`kpp-hero__avatar kpp-hero__avatar--${tier.cls}`}>
              <Avatar src={kol.avatar_url} alt={cleanHandle} size={92} />
              {verified && <span className="kpp-hero__tick"><VerifiedTick size={16} /></span>}
            </span>

            <div className="kpp-hero__id">
              <div className="kpp-hero__name-row">
                <h1 className="kpp-hero__name">{kol.name || `@${cleanHandle}`}</h1>
                <span className={`xd-kol-tierbadge xd-kol-tierbadge--${tier.cls}`}>{t(tier.key, tier.fallback)}</span>
                {!notFound && hasTrackRecord && (
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
              <div className="kpp-hero__handle-row">
                {xUrl ? (
                  <a href={xUrl} target="_blank" rel="noopener noreferrer" className="kpp-hero__handle">
                    @{cleanHandle}<XLogoIcon />
                  </a>
                ) : (
                  <span className="kpp-hero__handle">@{cleanHandle}</span>
                )}
                {!notFound && (
                  <span className={`kpp-hero__archetype kpp-hero__archetype--${band}`}>
                    <span className="kpp-hero__archetype-score xd-num">{legitScore == null ? '—' : legitScore}</span>
                    {legitLabel}
                  </span>
                )}
              </div>

              {!notFound && (
                <div className="kpp-hero__stats">
                  <div className="kpp-hero__stat">
                    <span className="kpp-hero__stat-value xd-num">{formatNum(kol.followers_count)}</span>
                    <span className="kpp-hero__stat-label">{t('kolRadar.followers', 'followers')}</span>
                  </div>
                  <div className="kpp-hero__stat">
                    <span className="kpp-hero__stat-value xd-num">{formatNum(stats.following_tracked || followingSample.length)}</span>
                    <span className="kpp-hero__stat-label">{t('kolRadar.dossier.tracked', 'tracked')}</span>
                  </div>
                  <div className="kpp-hero__stat">
                    <span className="kpp-hero__stat-value xd-num">{formatNum(stats.new_follows_7d || 0)}</span>
                    <span className="kpp-hero__stat-label">{t('kolRadar.dossier.newFollows7d', 'new · 7d')}</span>
                  </div>
                  <div className="kpp-hero__stat">
                    <span className="kpp-hero__stat-value xd-num">{formatNum(stats.projects_followed || 0)}</span>
                    <span className="kpp-hero__stat-label">{t('kolRadar.dossier.projects', 'projects')}</span>
                  </div>
                  {endorsedCapStr && (
                    <div className="kpp-hero__stat kpp-hero__stat--cap">
                      <span className="kpp-hero__stat-value xd-num">{endorsedCapStr}</span>
                      <span className="kpp-hero__stat-label">{t('kolRadar.dossier.endorsedCap', 'endorsed cap')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="kpp-hero__actions">
              <button
                type="button"
                className={`kpp-hero__follow${tracked ? ' kpp-hero__follow--on' : ''}`}
                onClick={() => toggleFollow && toggleFollow(cleanHandle)}
                aria-pressed={tracked}
              >
                <StarIcon filled={tracked} />
                {tracked ? t('kolRadar.profile.tracking', 'Tracking') : t('kolRadar.profile.track', 'Track')}
              </button>
              {xUrl && (
                <a href={xUrl} target="_blank" rel="noopener noreferrer" className="kpp-hero__xbtn">
                  <XLogoIcon size={14} />
                  {t('kolRadar.profile.viewOnX', 'View on X')}
                </a>
              )}
            </div>
          </div>
        )}
      </header>

      {/* BODY */}
      <div className="kpp-body">
        {error && <ErrorState message={error} onRetry={refetch} />}
        {isLoading && (
          <div className="kpp-skeleton">
            <div className="kpp-card kpp-card--bubbles kpp-skel-bubbles">
              <div className="kpp-skel-field" aria-hidden="true">
                {[104, 84, 120, 72, 96, 64, 110, 80, 58].map((d, i) => (
                  <span
                    key={i}
                    className="kpp-skel-bubble animate-shimmer"
                    style={{ width: d, height: d }}
                  />
                ))}
              </div>
            </div>
            <Shimmer variant="card" count={3} />
          </div>
        )}

        {notFound && (
          <div className="kpp-notfound">
            <p className="kpp-notfound__title">
              {t('kolRadar.dossier.notFound.title', 'Not enough data on @{{handle}} yet', { handle: cleanHandle })}
            </p>
            <p className="kpp-notfound__detail">
              {t('kolRadar.dossier.notFound.detail', "We don't track this account yet — once it shows up in the follow graph, its dossier and legitimacy will fill in here.")}
            </p>
            <button type="button" className="kpp-notfound__back" onClick={goBack}>
              {t('kolRadar.profile.back', 'KOL Radar')}
            </button>
          </div>
        )}

        {data && !notFound && (
          /* COMPARTMENTS — one dense masonry of self-contained cards. No fixed
             column split, no reserved empty height. The endorsement bubble field
             spans all columns (a wide band); the rest pack + fill beneath it.
             Order tuned so the masonry balances: ledger (tall, when present),
             bubbles (full-width band), then legitimacy / network / projects /
             recent-follows flow into the 3 columns and fill the gaps. */
          <div className="kpp-masonry">
            {hasTrackRecord && (
              <section className="kpp-card kpp-card--ledger">
                <KolCallLedger
                  trackRecord={trackRecord}
                  archetype={archetype}
                  credibility={credibility}
                />
              </section>
            )}

            {/* endorsement bubble field — a COMPACT, filled compartment (spans
                all columns). Size = market cap, fill/ring = health, hover = card. */}
            {endorsements.length > 0 && (
              <section className="kpp-card kpp-card--bubbles">
                <div className="kpp-bubbles-head">
                  <div className="kpp-card__label">{t('kolRadar.profile.endorsements', 'What they endorse')}</div>
                  <div className="kpp-bubbles-meta">
                    <span className="kpp-bubbles-meta__n xd-num">{endorsements.length}</span>
                    <span className="kpp-bubbles-meta__lbl">{t('kolRadar.bubbles.projects', 'projects')}</span>
                    {endorsedCapStr && (
                      <>
                        <span className="kpp-bubbles-meta__sep" aria-hidden="true">·</span>
                        <span className="kpp-bubbles-meta__n xd-num">{endorsedCapStr}</span>
                        <span className="kpp-bubbles-meta__lbl">{t('kolRadar.bubbles.combinedCap', 'combined cap')}</span>
                      </>
                    )}
                  </div>
                </div>
                <KolProjectBubbles endorsements={endorsements} calls={calls} onOpenProject={openProject} />
              </section>
            )}

            <section className="kpp-card kpp-legit">
              <div className="kpp-card__label">{t('kolRadar.legit.title', 'Legitimacy')}</div>
              <div className="kpp-legit__head">
                <LegitRing score={legitScore} band={band} />
                <div className="kpp-legit__head-text">
                  <span className={`kpp-legit__archetype kpp-legit__archetype--${band}`}>{legitLabel}</span>
                  {hasBreakdown ? (
                    <div className="kpp-legit__breakdown">
                      <span className="kpp-legit__bd kpp-legit__bd--green">
                        <b className="xd-num">{alive}</b> {t('kolRadar.health.alive', 'alive')}
                      </span>
                      <span className="kpp-legit__bd-sep" aria-hidden="true">·</span>
                      <span className="kpp-legit__bd kpp-legit__bd--amber">
                        <b className="xd-num">{cooling}</b> {t('kolRadar.health.cooling', 'cooling')}
                      </span>
                      <span className="kpp-legit__bd-sep" aria-hidden="true">·</span>
                      <span className="kpp-legit__bd kpp-legit__bd--red">
                        <b className="xd-num">{dead}</b> {t('kolRadar.health.dead', 'dead')}
                      </span>
                    </div>
                  ) : (
                    <span className="kpp-legit__none">
                      {t('kolRadar.legit.noData', 'Not enough rated endorsements to score yet.')}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="kpp-card kpp-card--net">
              <div className="kpp-card__label">{t('kolRadar.dossier.network', 'Follow network')}<SampleFollowBadge provider={data?.provider} size="sm" /></div>
              {followLive ? (
                <KolFollowNetwork kol={kol} accounts={followingSample} onOpenProject={openProject} />
              ) : (
                <p className="kpp-empty">{t('kolRadar.feed.notLive.detail', "This maps who the KOL follows — it fills in once the follow data source is connected.")}</p>
              )}
            </section>

            <section className="kpp-card">
              <div className="kpp-card__label">{t('kolRadar.dossier.pushes', 'Projects followed')}</div>
              {pushes.filter((p) => p && (p.symbol || p.name)).length > 0 ? (
                <div className="kpp-chips">
                  {pushes.filter((p) => p && (p.symbol || p.name)).slice(0, 24).map((p, i) => (
                    <ProjectChip key={p.cg_id || p.symbol || i} project={p} onOpenProject={openProject} />
                  ))}
                </div>
              ) : (
                <p className="kpp-empty">{t('kolRadar.card.noPushes', 'No recent pushes')}</p>
              )}
            </section>

            {Array.isArray(data?.name_mentions) && data.name_mentions.length > 0 && (
              <section className="kpp-card">
                <div className="kpp-card__label">
                  {t('kolRadar.profile.nameMentions', 'Talked about · no $ticker')}
                  <SampleFollowBadge provider={data?.name_mention_provider} size="sm" />
                </div>
                <div className="kpp-chips">
                  {data.name_mentions.slice(0, 12).map((p, i) => (
                    <ProjectChip key={p.cg_id || p.symbol || i} project={p} onOpenProject={openProject} />
                  ))}
                </div>
                <p className="kpp-nm-hint">{t('kolRadar.profile.nameMentionsHint', 'Projects they mention by name — caught beyond cashtag tracking.')}</p>
              </section>
            )}

            <section className="kpp-card">
              <div className="kpp-card__label">{t('kolRadar.dossier.recentFollows', 'Recent new follows')}<SampleFollowBadge provider={data?.provider} size="sm" /></div>
              {!followLive ? (
                <p className="kpp-empty">{t('kolRadar.feed.notLive.detail', 'Real new-follow events will stream here once the follow data source is connected.')}</p>
              ) : recentFollows.length > 0 ? (
                <div className="kpp-followscroll">
                  <ul className="kpp-followlist">
                    {recentFollows.slice(0, 24).map((ev) => (
                      <FollowRow key={ev.id} event={ev} onOpenProject={openProject} t={t} />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="kpp-empty">{t('kolRadar.dossier.noFollows', 'No new follows tracked yet for this KOL.')}</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
