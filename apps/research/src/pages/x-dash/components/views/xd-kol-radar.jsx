/**
 * KOL RADAR — the container view. Mounted inside the X Dash view switch, so it
 * inherits the page's onOpenProject opener (navigates to /x-dash/token/:cgId).
 *
 * Layout (top → bottom):
 *   1. Hero "Smart Signals" convergence board (KolSignalsBoard) — the money shot.
 *   2. Scope toggle ("All KOLs" vs "My Radar") + filters, in the filters bar.
 *   3. Two-col body: main = Giga KOL DB grid (paginated, follow toggles);
 *      right rail = live "New Follows" feed.
 *
 * Scope flows into the signals + feed + db (scope=mine filters to the user's
 * followed KOLs). Following lives in useKolFollows (localStorage + server sync
 * when authed). useKolFollowAlerts() is mounted here so convergence/new-follow
 * notifications fire while the radar is open.
 *
 * Clicking a KOL opens the dossier drawer (local state — self-contained, no
 * route param). Clicking a project chip/target calls onOpenProject.
 */
import { Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import lazyWithRetry from '@/lib/lazy-with-retry'
import { usePrivySafe } from '@/lib/use-privy-safe'
import { useKolSignals } from '@/hooks/useKolSignals'
import { useKolFeed } from '@/hooks/useKolFeed'
import { useKolDb } from '@/hooks/useKolDb'
import { useKolFollows, DEFAULT_FOLLOWS } from '@/hooks/useKolFollows'
import { useKolFollowAlerts } from '@/hooks/useKolFollowAlerts'
import KolSignalsBoard from './kol-radar/kol-signals-board'
import KolFiltersBar from './kol-radar/kol-filters-bar'
import KolDbGrid from './kol-radar/kol-db-grid'
import KolFeedRail from './kol-radar/kol-feed-rail'
import './kol-radar/xd-kol-radar.css'
import './kol-radar/xd-kol-radar.day-mode.css'
import './kol-radar/xd-kol-radar.mobile.css'

// Dossier drawer drags in the mini follow-network SVG + a full dossier fetch.
// Lazy so it only loads when a KOL is opened (rendered inside the page <Suspense>).
const KolDossierDrawer = lazyWithRetry(() => import('./kol-radar/kol-dossier-drawer'))

/* Narrative options for the filter dropdown. The DB sends each KOL a free-form
   narratives[] array; we surface a curated, stable set so the dropdown doesn't
   churn as the feed shifts. Keys match what the server filters on. */
const NARRATIVE_OPTIONS = [
  { key: 'defi', label: 'DeFi' },
  { key: 'memecoins', label: 'Memecoins' },
  { key: 'ai', label: 'AI' },
  { key: 'rwa', label: 'RWA' },
  { key: 'gaming', label: 'Gaming' },
  { key: 'l1', label: 'L1 / L2' },
  { key: 'nfts', label: 'NFTs' },
  { key: 'depin', label: 'DePIN' },
]

export default function XDKolRadar({ onOpenProject }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // login entry point — same one the header / x-dash auth banner uses. Calling
  // it mounts the Privy provider on demand, so an anon user can sign in to sync
  // their radar + receive alerts.
  const privy = usePrivySafe()
  const authed = Boolean(privy?.authenticated)
  const privyLogin = privy?.login

  /* scope drives signals/feed/db: 'all' = every tracked KOL, 'mine' = only the
     user's followed set. */
  const [scope, setScope] = useState('all')

  /* DB filters */
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState('all')
  const [narrative, setNarrative] = useState('all')
  const [sort, setSort] = useState('influence')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(30)

  /* dossier drawer — local state (handle string). null = closed. */
  const [dossierHandle, setDossierHandle] = useState(null)

  /* per-user "My KOLs" follow set */
  const {
    isFollowing, toggleFollow, followMany, count: followCount,
  } = useKolFollows()

  /* One-click big-guns pack: how many of the founder's default set (Ansem,
     IncomeSharks, CryptoWizardd, …) are NOT yet on the radar. New devices
     are seeded with the pack automatically; this covers radars that predate
     the seed or pruned it. */
  const bigGunsRemaining = useMemo(
    () => DEFAULT_FOLLOWS.filter((h) => !isFollowing(h)).length,
    [isFollowing],
  )
  const followBigGuns = useCallback(() => followMany(DEFAULT_FOLLOWS), [followMany])

  /* Mount the alert poller so convergence / new-follow notifications fire while
     the radar is open. Self-guards: only polls when authed + following ≥1 +
     convergence pref on. */
  useKolFollowAlerts()

  /* hero convergence board — min_kols=2 surfaces emerging signals too */
  const signalsParams = useMemo(() => ({ scope, windowHours: 72, minKols: 2 }), [scope])
  const {
    data: signalsData, loading: signalsLoading, error: signalsError, refetch: refetchSignals,
  } = useKolSignals(signalsParams)

  /* live new-follows feed */
  const feedParams = useMemo(() => ({ scope, page: 1, perPage: 40 }), [scope])
  const {
    data: feedData, loading: feedLoading, error: feedError, refetch: refetchFeed,
  } = useKolFeed(feedParams)

  /* Giga KOL DB grid. When scope is 'mine' the server filters to the user's
     followed handles (passed through as the `mine` flag via tier? — the DB
     endpoint scopes by the authed user; for anon 'mine', the grid empty-state
     guides them to star KOLs). */
  const dbParams = useMemo(() => ({
    q: query.trim(),
    tier,
    narrative,
    sort,
    page,
    perPage,
    scope,
  }), [query, tier, narrative, sort, page, perPage, scope])
  const {
    data: dbData, loading: dbLoading, error: dbError, refetch: refetchDb,
  } = useKolDb(dbParams)

  const handleScope = useCallback((next) => {
    setScope(next)
    setPage(1)
  }, [])

  const handleQueryChange = useCallback((v) => { setQuery(v); setPage(1) }, [])
  const handleTier = useCallback((v) => { setTier(v); setPage(1) }, [])
  const handleNarrative = useCallback((v) => { setNarrative(v); setPage(1) }, [])
  const handleSort = useCallback((v) => { setSort(v); setPage(1) }, [])

  const openDossier = useCallback((handle) => {
    if (!handle) return
    setDossierHandle(String(handle).replace(/^@/, ''))
  }, [])
  const closeDossier = useCallback(() => setDossierHandle(null), [])

  /* Full-screen profile navigation. A directory lookup ("Look up @handle") is
     an intentional dig into one KOL, so it lands on the full profile page
     rather than the in-grid peek drawer (which is for quick glances). */
  const openProfile = useCallback((handle) => {
    if (!handle) return
    navigate(`/x-dash/kol/${encodeURIComponent(String(handle).replace(/^@/, ''))}`)
  }, [navigate])

  const handleOpenProject = useCallback((cgId) => {
    if (!cgId) return
    // Close the dossier first so the token drawer (which the page opens on the
    // /x-dash/token/:cgId route) isn't stacked behind our local drawer.
    setDossierHandle(null)
    if (onOpenProject) onOpenProject(cgId)
  }, [onOpenProject])

  const signals = signalsData?.signals
  const events = feedData?.events
  const kols = dbData?.kols
  const pagination = dbData?.pagination
  // provider tells us whether the follow feed is live (twitterapiio) or sample
  // (mock). Surfaced on the signals board as a "Preview" chip. Signals carries
  // it; fall back to the feed meta if the signals response omits it.
  const provider = signalsData?.provider || feedData?.provider

  /* Handle-lookup affordance: when the DB grid returns no match for what looks
     like an X handle, offer to resolve it on demand (the dossier endpoint now
     resolves any X-Dash-tracked author, not just the top-500). */
  const trimmedQuery = query.trim()
  const handleCandidate = trimmedQuery.replace(/^@/, '')
  const looksLikeHandle = /^[A-Za-z0-9_]{2,15}$/.test(handleCandidate)
  const gridHasMatch = Array.isArray(kols) && kols.length > 0
  const showHandleLookup = Boolean(
    looksLikeHandle && !dbLoading && !dbError && !gridHasMatch,
  )

  return (
    <div className="xd-kol">
      {/* HERO — Smart Signals convergence board */}
      <KolSignalsBoard
        signals={signals}
        loading={signalsLoading}
        error={signalsError}
        onRetry={refetchSignals}
        scope={scope}
        onOpenKol={openDossier}
        onOpenProject={handleOpenProject}
        provider={provider}
      />

      {/* FILTERS — scope toggle + search + tier/narrative/sort */}
      <KolFiltersBar
        scope={scope}
        onScope={handleScope}
        followCount={followCount}
        query={query}
        onQueryChange={handleQueryChange}
        tier={tier}
        onTier={handleTier}
        narrative={narrative}
        onNarrative={handleNarrative}
        sort={sort}
        onSort={handleSort}
        narrativeOptions={NARRATIVE_OPTIONS}
        bigGunsRemaining={bigGunsRemaining}
        onFollowBigGuns={followBigGuns}
      />

      {/* sign-in affordance — anon users can browse + locally follow, but the
          server sync + live alerts need auth. Only shown when signed out. */}
      {!authed && (
        <div className="xd-kol-authnote">
          <span className="xd-kol-authnote__text">
            {followCount > 0
              ? t('kolRadar.auth.haveFollows', 'Your radar is saved on this device. Sign in to sync it everywhere and get alerted the moment your KOLs converge.')
              : t('kolRadar.auth.noFollows', 'Star KOLs to build your radar. Sign in to sync across devices and get alerted when several of them pile into the same new project.')}
          </span>
          {privyLogin && (
            <button type="button" className="xd-kol-authnote__cta" onClick={() => privyLogin()}>
              {t('kolRadar.auth.cta', 'Sign in to sync + get alerts')}
            </button>
          )}
        </div>
      )}

      {/* HANDLE LOOKUP — the search engine. When the grid has no match for a
          handle-shaped query, resolve it on demand via the dossier drawer
          (backend resolves any tracked author). */}
      {showHandleLookup && (
        <button
          type="button"
          className="xd-kol-lookup"
          onClick={() => openProfile(handleCandidate)}
        >
          <span className="xd-kol-lookup__icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <span className="xd-kol-lookup__text">
            {t('kolRadar.lookup.cta', 'Look up')}{' '}
            <b className="xd-kol-lookup__handle">@{handleCandidate}</b>
          </span>
          <span className="xd-kol-lookup__hint">
            {t('kolRadar.lookup.hintProfile', 'Open full profile')}
          </span>
        </button>
      )}

      {/* BODY — DB grid (main) + new-follows feed (rail) */}
      <div className="xd-kol-layout">
        <div className="xd-kol-layout__main">
          <KolDbGrid
            kols={kols}
            pagination={pagination}
            loading={dbLoading}
            error={dbError}
            onRetry={refetchDb}
            scope={scope}
            isFollowing={isFollowing}
            onToggleFollow={toggleFollow}
            onOpen={openDossier}
            onOpenProject={handleOpenProject}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(n) => { setPerPage(n); setPage(1) }}
          />
        </div>
        <div className="xd-kol-layout__rail">
          <KolFeedRail
            events={events}
            loading={feedLoading}
            error={feedError}
            onRetry={refetchFeed}
            scope={scope}
            onOpenKol={openDossier}
            onOpenProject={handleOpenProject}
            provider={provider}
          />
        </div>
      </div>

      {/* DOSSIER DRAWER — local-state driven, lazy */}
      <Suspense fallback={null}>
        {dossierHandle && (
          <KolDossierDrawer
            handle={dossierHandle}
            onClose={closeDossier}
            isFollowing={isFollowing}
            onToggleFollow={toggleFollow}
            onOpenProject={handleOpenProject}
          />
        )}
      </Suspense>
    </div>
  )
}
