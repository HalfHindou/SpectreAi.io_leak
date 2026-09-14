/*
 * Potential Gainers - the flagship premium X Dash signal command center.
 *
 * Six zones, proof-first:
 *   1. Header        - title, verification headline, How-it-works tour
 *   2. THE EDGE       - cumulative equity-curve hero (lightweight-charts)
 *   3. THE RECORD     - one honest verdict (official win rate, W-L record)
 *   4. LIVE NOW       - controls + lifecycle rail + signal board / matrix
 *   5. PROVEN CALLS   - win-rate maturity chart, biggest calls, receipts
 *   6. Advanced       - hourly tape + return bubble map (collapsed)
 *
 * Gating: free users see everything EXCEPT the live board (masked preview +
 * blur + unlock CTA). Proof layers stay free - they are the conversion.
 *
 * A first-visit guided tour (PGTour) walks new visitors through the zones.
 * No prediction language: "flagged", "tracked", "measured" - never "predicted".
 */
import { useState, useCallback, useMemo, useRef, useEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useMomentumSetups, useMomentumSignals } from '@/hooks/useMomentumData'
import { useXDashTrackRecord } from '@/hooks/useXDashTrackRecord'
import useSettingsStore from '@/store/useSettingsStore'
import { trackUi } from '@/services/analytics'
import useMomentumAccess from './use-momentum-access'
import useLiveMarketCaps from './use-live-mcaps'
import PGEdge from './pg-edge'
import PGVerdict from './pg-verdict'
import PGBoard from './pg-board'
import PGReceipts from './pg-receipts'
import PGLockOverlay from './pg-lock-overlay'
import PGLifecycleRail from './pg-lifecycle-rail'
import PGHeatGrid from './pg-heat-grid'

/* Below-fold zones. PGEdge (the equity-curve hero) stays eager - it's the
   above-fold proof that anchors first paint. PGTrackRecord renders below the
   fold; PGHistory + PGBubbleMap live inside the collapsed-by-default Advanced
   section. Lazy-loading all three keeps their component code (PGTrackRecord
   pulls lightweight-charts chart setup) out of the initial page chunk so the
   hero + board paint first. */
const PGTrackRecord = lazy(() => import('./pg-track-record'))
const PGHistory = lazy(() => import('./pg-history'))
const PGBubbleMap = lazy(() => import('./pg-bubble-map'))
import PGTour from './pg-tour'
import { PG_TOUR_STEPS } from './pg-tour-steps'
import SocialDisclaimer from '@/components/social-disclaimer'
import { MOMENTUM_DISCLAIMER, toNumber } from './pg-utils'
import './potential-gainers-page.css'
import './potential-gainers-page.day-mode.css'
import './potential-gainers-page.mobile.css'

/* Token + author detail drawers, reused from X Dash. Lazy-loaded so the
   x-dash stylesheet only loads when a user actually opens a drawer. */
const TokenDrawer = lazy(() => import('./pg-xdash-drawers').then((m) => ({ default: m.XDTokenDrawer })))
const AuthorDrawer = lazy(() => import('./pg-xdash-drawers').then((m) => ({ default: m.XDAuthorDrawer })))

const TIMEFRAMES = [
  {
    key: '24h',
    label: 'Fast Breakouts',
    tradeoff: 'more shots, fresher signals - higher variance, a lower hit rate.',
  },
  {
    key: '7d',
    label: 'Sustained Conviction',
    tradeoff: 'fewer, slower setups - cleaner, with a higher hit rate.',
  },
]
const BUCKETS = [
  { key: 'top10', label: 'Top 10', limit: 10 },
  { key: 'top20', label: 'Top 20', limit: 20 },
]
const WATCH_DAYS = 10

const RefreshGlyph = ({ spinning }) => (
  <svg
    className={spinning ? 'pg-spin' : undefined}
    width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
)

const ChevronGlyph = ({ open }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }}
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const ShieldGlyph = () => (
  <svg
    width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

const CheckGlyph = () => (
  <svg
    width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const HelpGlyph = () => (
  <svg
    width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

export default function PotentialGainersPage() {
  const { isPaid, isPreviewUnlock } = useMomentumAccess()

  const dayMode = useSettingsStore((s) => s.dayMode)
  const pgTourSeen = useSettingsStore((s) => s.pgTourSeen)
  const setPgTourSeen = useSettingsStore((s) => s.setPgTourSeen)

  const [timeframe, setTimeframeRaw] = useState('24h')
  const [bucket, setBucketRaw] = useState('top10')
  const [refreshing, setRefreshing] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [boardView, setBoardViewRaw] = useState('cards')
  // tracked setters - all call sites are user clicks (no programmatic resets)
  const setTimeframe = (v) => { trackUi('pg_filter', v, { filter: 'timeframe' }); setTimeframeRaw(v) }
  const setBucket = (v) => { trackUi('pg_filter', v, { filter: 'bucket' }); setBucketRaw(v) }
  const setBoardView = (v) => { trackUi('pg_tab', v); setBoardViewRaw(v) }

  const limit = BUCKETS.find((b) => b.key === bucket)?.limit || 10
  const activeTf = TIMEFRAMES.find((t) => t.key === timeframe) || TIMEFRAMES[0]

  /* Performance summary - used only for the Track Record's equal-weight PnL. */
  const { data: summaryData, refetch: refetchSummary } = useMomentumSetups({
    timeframe,
    limit,
    scanLimit: 500,
  })
  const performanceSummary = summaryData?.performance_summary || null

  /* The signal board itself. */
  const {
    data: signalsData,
    loading: signalsLoading,
    error: signalsError,
    refetch: refetchSignals,
  } = useMomentumSignals({ timeframe, bucket, watchDays: WATCH_DAYS, limit: 100 })

  const signals = Array.isArray(signalsData?.tokens) ? signalsData.tokens : []
  const generatedAt = signalsData?.generated_at_utc
  const phaseCounts = signalsData?.phase_counts || null

  /* Live layer - CoinGecko market caps let the current/since-signal return
     tick live (~60s) instead of waiting for the 2-minute board poll. */
  const cgIds = useMemo(() => signals.map((r) => r?.token?.cg_id).filter(Boolean), [signals])
  const { mcaps: liveMcaps, live: isLive } = useLiveMarketCaps(cgIds)

  /* First-seen anchor - the momentum_origin ledger (X Dash track-record) records
     the mcap at the token's FIRST X Dash sighting, which is EARLIER than the PG
     flag (the flag fires only when a token climbs into the top-10, by which point
     fast movers have already run). Overlaying it lets the board tell the honest
     story: first seen -> flagged -> now. ROI-sorted so the runners we most want
     to anchor rank first; cached 5min, purely additive (missing = graceful). */
  const { ledger: trackRecord } = useXDashTrackRecord({ sort: 'roi', limit: 1000 })
  const firstSeenByCgId = useMemo(() => {
    const calls = Array.isArray(trackRecord?.calls) ? trackRecord.calls : []
    // The X Dash data window has a fixed start; a token whose first-seen sits AT
    // that horizon predates our data, so its entry mcap is the data FLOOR, not a
    // verified early catch - claiming "spotted at $X" there would overstate ROI.
    // Self-calibrate the horizon from the earliest entry_date in the ledger (no
    // hardcoded date - it moves as old data ages out) and refuse to anchor rows
    // sitting on it. ~54% of the ledger is horizon-capped; only genuine sightings
    // after it earn a "spotted" claim (ANSEM 06-28, FEBU 07-10, ...).
    let horizonMs = Infinity
    for (const c of calls) {
      const t = c?.entry_date ? Date.parse(c.entry_date) : NaN
      if (!Number.isNaN(t) && t < horizonMs) horizonMs = t
    }
    const HORIZON_GRACE_MS = 36 * 3600 * 1000
    const map = {}
    for (const c of calls) {
      const id = c?.asset
      const mc = toNumber(c?.entry_market_cap)
      const t = c?.entry_date ? Date.parse(c.entry_date) : NaN
      const atHorizon = !Number.isNaN(t) && Number.isFinite(horizonMs) && t <= horizonMs + HORIZON_GRACE_MS
      if (id && mc != null && mc > 0 && !atHorizon) {
        map[id] = {
          mcap: mc,
          at: c?.entry_date || null,
          peakRoi: toNumber(c?.peak_roi_pct),
          peakMcap: toNumber(c?.peak_market_cap),
        }
      }
    }
    return map
  }, [trackRecord])

  /* Enrich each signal row with (a) the live current mcap - ONLY the current
     return is recomputed, 24h/48h/72h/peak stay backend fields - and (b) the
     first-seen anchor when we saw it EARLIER and materially LOWER than the flag
     (< 0.9x the flag mcap), so we never invent a "first seen" that just equals
     the flag. Any token missing from either overlay keeps its backend values. */
  const liveSignals = useMemo(() => {
    const hasLive = liveMcaps && Object.keys(liveMcaps).length > 0
    const hasFirstSeen = Object.keys(firstSeenByCgId).length > 0
    if (signals.length === 0 || (!hasLive && !hasFirstSeen)) return signals
    return signals.map((row) => {
      const cgId = row?.token?.cg_id
      const pg = row?.potential_gainer
      if (!pg) return row
      const signalMcap = toNumber(pg?.signal?.market_cap)
      const liveMcap = hasLive && cgId ? liveMcaps[cgId] : null
      const fs = cgId ? firstSeenByCgId[cgId] : null
      const firstSeen = (fs && signalMcap != null && signalMcap > 0 && fs.mcap < signalMcap * 0.9)
        ? fs
        : null
      if (liveMcap == null && !firstSeen) return row
      const nextPg = { ...pg }
      if (liveMcap != null && signalMcap != null && signalMcap > 0) {
        nextPg.current_market_cap = liveMcap
        nextPg.return_since_signal_pct = (liveMcap / signalMcap - 1) * 100
      }
      if (firstSeen) nextPg.first_seen = firstSeen
      return { ...row, potential_gainer: nextPg }
    })
  }, [signals, liveMcaps, firstSeenByCgId])

  /* Live board stats - active (fresh + developing) signal count + the share
     currently green. A live mark-to-market read, headlined on Live Now. */
  const liveStats = useMemo(() => {
    if (liveSignals.length === 0) return null
    let active = 0
    let green = 0
    for (const row of liveSignals) {
      const pg = row?.potential_gainer
      if (!pg) continue
      const phase = String(pg.lifecycle?.phase || '')
      if (phase === 'fresh' || phase === 'developing') {
        active += 1
        const ret = toNumber(pg.return_since_signal_pct)
        if (ret != null && ret > 0) green += 1
      }
    }
    return { active, greenWR: active > 0 ? Math.round((green / active) * 100) : null }
  }, [liveSignals])

  const handleRefresh = () => {
    setRefreshing(true)
    refetchSignals({ background: true })
    refetchSummary({ background: true })
    window.setTimeout(() => setRefreshing(false), 700)
  }

  const handleUnlock = () => {
    // Subscription checkout TBD — route to pricing for now instead of a
    // native window.alert that exposed internal "placeholder" copy.
    if (typeof window !== 'undefined') {
      window.location.assign('/pricing')
    }
  }

  /* Token / author detail drawers. Clicking any token on the board or heat
     grid opens the X Dash token drawer for that cg_id; author links inside
     it open the author drawer. */
  const [drawerCgId, setDrawerCgId] = useState(null)
  const [drawerAuthorId, setDrawerAuthorId] = useState(null)
  const [drawerFullscreen, setDrawerFullscreen] = useState(false)

  const openToken = useCallback((cgId) => {
    if (!cgId) return
    setDrawerAuthorId(null)
    setDrawerCgId(String(cgId))
  }, [])
  const openAuthor = useCallback((authorId) => {
    if (!authorId) return
    setDrawerCgId(null)
    setDrawerAuthorId(String(authorId))
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawerCgId(null)
    setDrawerAuthorId(null)
    setDrawerFullscreen(false)
  }, [])
  const toggleDrawerFullscreen = useCallback(() => setDrawerFullscreen((v) => !v), [])

  /* ── Guided tour ───────────────────────────────────────────────────── */
  const [tourActive, setTourActive] = useState(false)
  const [tourStep, setTourStep] = useState(0)
  const autoStartedRef = useRef(false)

  const startTour = useCallback(() => {
    setTourStep(0)
    setTourActive(true)
  }, [])
  const endTour = useCallback(() => {
    setTourActive(false)
    setPgTourSeen(true)
  }, [setPgTourSeen])
  const handleTourNext = () => {
    if (tourStep >= PG_TOUR_STEPS.length - 1) endTour()
    else setTourStep(tourStep + 1)
  }
  const handleTourBack = () => setTourStep((s) => Math.max(0, s - 1))

  /* First visit: auto-launch the tour once the board has loaded. */
  useEffect(() => {
    if (autoStartedRef.current || pgTourSeen) return undefined
    if (signalsLoading || !signalsData) return undefined
    autoStartedRef.current = true
    const t = setTimeout(() => setTourActive(true), 900)
    return () => clearTimeout(t)
  }, [pgTourSeen, signalsLoading, signalsData])

  const showMaskedBoard = !isPaid
  const boardLoading = signalsLoading && !signalsData

  return (
    <div className="pg-page">
      {/* ── HEADER ────────────────────────────────────────────────────── */}
      <header className="pg-page__header">
        <div className="pg-page__title-block">
          <div className="pg-page__eyebrow">
            <span className="pg-page__pro">PRO</span>
            <span>X Dash &middot; Premium</span>
          </div>
          <h1 className="pg-page__title">Potential Gainers</h1>
          <p className="pg-page__subtitle">
            Tokens Spectre&rsquo;s social-intelligence model flagged before momentum expansion —
            tracked from the first signal, not a daily leaderboard.
          </p>
          <div className="pg-page__verify">
            <span className="pg-page__verify-mark" aria-hidden="true"><CheckGlyph /></span>
            <span>
              Every signal is timestamped before the move and tracked to a 72-hour exit —
              the win rate counts the losers too.
            </span>
          </div>
          <span
            className="pg-trust-badge"
            data-tooltip="Rows with cashtag-only, cross-token duplicate signals are excluded from proof metrics unless explicitly requested."
            data-tooltip-pos="bottom"
          >
            <ShieldGlyph />
            Identity-filtered: shared ticker spillovers excluded
          </span>
        </div>
        <div className="pg-page__header-meta">
          {isLive && (
            <span
              className="pg-live-pill"
              title="Current / since-signal returns recompute live from CoinGecko market caps"
            >
              <span className="pg-live-pill__dot" aria-hidden="true" />
              LIVE
            </span>
          )}
          {generatedAt && (
            <span className="pg-page__updated">
              signals updated {new Date(generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            className="pg-btn pg-btn--ghost pg-page__tour-btn"
            onClick={startTour}
          >
            <HelpGlyph />
            How it works
          </button>
          <button
            type="button"
            className="pg-btn pg-btn--icon"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh signals"
          >
            <RefreshGlyph spinning={refreshing} />
          </button>
        </div>
      </header>

      {isPreviewUnlock && (
        <div className="pg-preview-banner">
          Preview unlock active (<code>?unlock=1</code>) &mdash; this is a QA switch, not a real subscription.
        </div>
      )}

      {/* ── THE EDGE - cumulative equity-curve hero ────────────────────── */}
      <PGEdge timeframe={timeframe} bucket={bucket} />

      {/* ── THE RECORD - one honest verdict ────────────────────────────── */}
      <PGVerdict timeframe={timeframe} bucket={bucket} />

      {/* ── LIVE NOW - controls + lifecycle rail + board / matrix ──────── */}
      <section className="pg-section pg-section--live" data-tour="pg-live">
        <div className="pg-section__head pg-section__head--live">
          <div>
            <h2 className="pg-section__title">Live Now</h2>
            <p className="pg-section__sub">
              Every token Spectre flagged as a clean social-momentum setup, grouped by lifecycle.
              Returns usually play out over the next 72 hours — you do not have to be first.
            </p>
          </div>
          {liveStats && (
            <div className="pg-livestats" aria-label="Live board summary">
              <span className="pg-livestat">
                <span className="pg-livestat__val">{liveStats.active}</span>
                <span className="pg-livestat__label">active</span>
              </span>
              {liveStats.greenWR != null && (
                <span className="pg-livestat">
                  <span className="pg-livestat__val">{liveStats.greenWR}%</span>
                  <span className="pg-livestat__label">green now</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="pg-controls">
          <div className="pg-controls__left">
            <div className="pg-filter">
              <span className="pg-filter__label">Signal source</span>
              <div className="pg-seg" role="group" aria-label="Signal source">
                {TIMEFRAMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`pg-seg__btn${timeframe === t.key ? ' pg-seg__btn--active' : ''}`}
                    onClick={() => setTimeframe(t.key)}
                    title={`${t.label} - ${t.tradeoff}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="pg-seg" role="group" aria-label="Board size">
              {BUCKETS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`pg-seg__btn${bucket === b.key ? ' pg-seg__btn--active' : ''}`}
                  onClick={() => setBucket(b.key)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pg-seg" role="group" aria-label="Board view">
            <button
              type="button"
              className={`pg-seg__btn${boardView === 'cards' ? ' pg-seg__btn--active' : ''}`}
              onClick={() => setBoardView('cards')}
            >
              Cards
            </button>
            <button
              type="button"
              className={`pg-seg__btn${boardView === 'matrix' ? ' pg-seg__btn--active' : ''}`}
              onClick={() => setBoardView('matrix')}
            >
              Matrix
            </button>
          </div>
          <p className="pg-controls__hint">
            <strong>{activeTf.label}</strong> &mdash; {activeTf.tradeoff}
          </p>
        </div>

        <PGLifecycleRail
          signals={liveSignals}
          loading={boardLoading}
          phaseCounts={phaseCounts}
        />

        <div className={`pg-board-wrap${showMaskedBoard ? ' pg-board-wrap--locked' : ''}`}>
          <div className={showMaskedBoard ? 'pg-board-masked' : undefined} aria-hidden={showMaskedBoard || undefined}>
            {boardView === 'cards' ? (
              <PGBoard
                signals={liveSignals}
                loading={boardLoading}
                error={signalsError}
                onRetry={() => refetchSignals()}
                masked={showMaskedBoard}
                onOpenToken={openToken}
              />
            ) : (
              <PGHeatGrid
                signals={liveSignals}
                loading={boardLoading}
                onOpenToken={openToken}
              />
            )}
          </div>
          {showMaskedBoard && <PGLockOverlay onUnlock={handleUnlock} />}
        </div>
      </section>

      {/* ── PROVEN CALLS - win-rate maturity chart, calls, receipts ────── */}
      <Suspense fallback={null}>
        <PGTrackRecord
          timeframe={timeframe}
          bucket={bucket}
          signals={liveSignals}
          signalsLoading={boardLoading}
          performanceSummary={performanceSummary}
          trackRecordCalls={trackRecord?.calls}
          onOpenToken={openToken}
        />
      </Suspense>
      <PGReceipts timeframe={timeframe} bucket={bucket} />

      {/* ── ADVANCED ANALYTICS (collapsed by default) ──────────────────── */}
      <div className="pg-advanced">
        <button
          type="button"
          className="pg-advanced__toggle"
          onClick={() => { trackUi('pg_tab', analyticsOpen ? 'analytics_close' : 'analytics_open'); setAnalyticsOpen((v) => !v) }}
          aria-expanded={analyticsOpen}
        >
          <span className="pg-advanced__toggle-label">Advanced analytics</span>
          <ChevronGlyph open={analyticsOpen} />
        </button>
        {analyticsOpen && (
          <Suspense fallback={null}>
            <div className="pg-advanced__body">
              <PGHistory timeframe={timeframe} bucket={bucket} />
              <section className="pg-section">
                <PGBubbleMap
                  signals={liveSignals}
                  loading={boardLoading}
                />
              </section>
            </div>
          </Suspense>
        )}
      </div>

      {/* ── DISCLAIMER - slim, expandable; keeps the momentum-specific note ── */}
      <SocialDisclaimer note={MOMENTUM_DISCLAIMER} />

      {/* ── TOKEN / AUTHOR DETAIL DRAWERS (reused from X Dash) ─────────── */}
      <Suspense fallback={null}>
        {drawerCgId && (
          <TokenDrawer
            cgId={drawerCgId}
            onClose={closeDrawer}
            onOpenAuthor={openAuthor}
            fullscreen={drawerFullscreen}
            onToggleFullscreen={toggleDrawerFullscreen}
          />
        )}
        {drawerAuthorId && (
          <AuthorDrawer
            authorId={drawerAuthorId}
            onClose={closeDrawer}
            onOpenToken={openToken}
            onOpenAuthor={openAuthor}
            fullscreen={drawerFullscreen}
            onToggleFullscreen={toggleDrawerFullscreen}
          />
        )}
      </Suspense>

      {/* ── FIRST-VISIT GUIDED TOUR ────────────────────────────────────── */}
      <PGTour
        steps={PG_TOUR_STEPS}
        isActive={tourActive}
        currentStep={tourStep}
        onNext={handleTourNext}
        onBack={handleTourBack}
        onSkip={endTour}
        dayMode={dayMode}
      />
    </div>
  )
}
