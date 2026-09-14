/**
 * MobileTokenPage — single-column phone layout for the token terminal.
 *
 * A pinned identity+price hero sits on top; the bottom carries a two-row
 * dock — a persistent Buy/Sell bar with a 5-tab view switcher just below
 * it. Tapping a tab swaps the main content area:
 *
 *   Info · Chart · Chart+Txns · Social · Trade
 *
 * "Trade" is an action tab (opens the swap sheet), the other four switch
 * the inline view. Default view is Chart+Txns.
 *
 * Drawers/overlays:
 *   - MobileWatchlistDrawer (left edge, hamburger trigger)
 *   - MobileSwapSheet       (bottom sheet, Buy/Sell + Trade trigger)
 *   - MobileAgentSheet      (Spectre Agent FAB)
 *   - MobileAlertSheet      (bottom sheet, bell button in the price hero)
 */
import React, { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import lazy from '../../lib/lazy-with-retry'
// From lib, NOT from ./home/MobileHomeShell - importing the constant off the
// shell pulled the whole mobile-home tree (five screens + CSS) into this chunk.
import { MHS_TAB_KEY } from '../../lib/mobileHomeTab'
import MobilePriceHero from './MobilePriceHero'
import MobileChartCard from './MobileChartCard'
import MobileDataTabs from './MobileDataTabs'
import MobileInfoBody from './MobileInfoBody'
import MobileBottomNav from './MobileBottomNav'
import MobileViewNav from './MobileViewNav'
import MobileSideRail from './MobileSideRail'
import MobileSwapSheet from './MobileSwapSheet'
import MobileWatchlistDrawer from './MobileWatchlistDrawer'
import MobileAgentSheet from './MobileAgentSheet'
import MobileAlertSheet from './MobileAlertSheet'
import MobilePullRefresh from './MobilePullRefresh'
import { useSharedTokenDetails } from '../../contexts/TokenDetailsContext'
import { useTokenAlerts } from '../../hooks/useAlerts'
import SpectreAgentFab from '../agent/SpectreAgentFab'
import MobileScrollTop from './MobileScrollTop'
import useSettingsStore from '../../store/useSettingsStore'
import { usePrivySafe } from '../../lib/use-privy-safe'
import { markAutoOpened, bumpVisit } from '../../hooks/useAgentBrief'
import { voiceSessionSupported } from '../../hooks/useVoiceSession'
import { useWakeWord } from '../../hooks/useWakeWord'
import { track, Events } from '../../services/analytics'
import './MobileTokenPage.css'

// The Social view mounts the desktop LeftPanel scoped to its social section
// (the X project feed: Project Posts / Replies / Community / KOLs). Heavy +
// only needed on the Social tab → lazy-load. Its feed styling is reused from
// the Explore drawer's `.mwd-body` rules (see MobileTokenPage.css).
const LeftPanel = lazy(() => import('../LeftPanel'))

export default function MobileTokenPage({
  token,
  selectToken,
  watchlist,
  addToWatchlist,
  removeFromWatchlist,
  togglePinWatchlist,
  reorderWatchlist,
  chartViewMode,
  setChartViewMode,
  alerts,
  rules,
  alertLines = [],
  createAlert,
  updateAlert,
  deleteAlert,
  onBack,
}) {
  // Which main view is showing inline.
  // 'info' | 'chart' | 'chart-txns' | 'social'.
  const [view, setView] = useState('chart-txns')

  // ── Pull-to-refresh (info / chart / chart-txns views) ─────────────────
  // One wrapper around the switchable content; the refresh action depends on
  // the active view. Details refetch (price/mcap/changes) runs for all of
  // them; chart-txns adds the trades refetch (registered by DataTabs);
  // info bumps a tick that force-refetches the per-window stats panel.
  const { refresh: refreshDetails } = useSharedTokenDetails() || {}
  // The context recreates `refresh` every render — keep it in a ref so the
  // pull handler stays referentially stable (the wrapper's listeners would
  // otherwise re-attach on every data tick).
  const refreshDetailsRef = useRef(refreshDetails)
  useEffect(() => { refreshDetailsRef.current = refreshDetails }, [refreshDetails])
  const tradesRefreshRef = useRef(null)
  const registerTradesRefresh = useCallback((fn) => { tradesRefreshRef.current = fn }, [])
  const [infoRefreshTick, setInfoRefreshTick] = useState(0)
  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])
  const handlePullRefresh = useCallback(() => {
    const jobs = []
    try { const p = refreshDetailsRef.current?.(); if (p) jobs.push(p) } catch { /* noop */ }
    if (viewRef.current === 'chart-txns') {
      try { const p = tradesRefreshRef.current?.(); if (p) jobs.push(p) } catch { /* noop */ }
    }
    if (viewRef.current === 'info') setInfoRefreshTick(t => t + 1)
    return Promise.allSettled(jobs)
  }, [])

  // Drawer + sheet state.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapMode, setSwapMode] = useState('buy') // 'buy' | 'sell'
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentPeek, setAgentPeek] = useState(false) // auto-open = half sheet
  const [agentVoiceFirst, setAgentVoiceFirst] = useState(false) // FAB tap = live voice
  const [alertOpen, setAlertOpen] = useState(false)
  // Set by a long-press on the chart (TradingChart's onAlertAtPrice); cleared
  // whenever the sheet closes so it never leaks into the NEXT bell-opened
  // sheet. Bell-opened sheets never touch this - it stays 0, and
  // MobileAlertSheet treats initialPrice<=0 as "no prefill".
  const [alertPrefillPrice, setAlertPrefillPrice] = useState(0)

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // VOICE FIRST: the FAB tap enters the live conversation directly (full
  // sheet); the token-load auto-open shows the speaking brief, never a mic.
  const openAgent = useCallback(() => { setAgentPeek(false); setAgentVoiceFirst(true); setAgentOpen(true) }, [])
  const closeAgent = useCallback(() => setAgentOpen(false), [])

  // "Hey Spectre" - hands-free activation while no overlay is up. Same
  // gates as desktop: voice opted-in, signed in, SR support, mic already
  // granted (the hook never prompts); yields the mic when the sheet opens.
  const agentVoicePref = useSettingsStore((s) => s.agentVoice)
  const privy = usePrivySafe()
  const wakeEnabled = !(drawerOpen || swapOpen || agentOpen)
    && voiceSessionSupported()
    && !!privy?.authenticated
    && agentVoicePref?.enabled === true
    && agentVoicePref?.wakeWord !== false
  const handleWake = useCallback(() => {
    if (token?.address) markAutoOpened(token)
    openAgent() // voice-first (sets agentVoiceFirst)
    track(Events.AGENT_WAKE_WORD, { surface: 'mobile', symbol: token?.symbol })
  }, [openAgent, token])
  const { armed: wakeArmed } = useWakeWord({ enabled: wakeEnabled, onWake: handleWake })

  // No auto-open on mobile either - see the note in SpectreAgentLauncher.
  // Landing on a token leaves the sheet closed; the FAB opens it. Visit memory
  // still updates so a manually-opened sheet greets as a repeat visit.
  useEffect(() => {
    if (!token?.address || token.symbol === '...') return
    bumpVisit(token) // salutation's visit memory (30s same-key dedupe inside)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.address, token?.networkId, token?.symbol])

  const openSwap = useCallback((mode = 'buy') => {
    setSwapMode(mode)
    setSwapOpen(true)
  }, [])
  const closeSwap = useCallback(() => setSwapOpen(false), [])

  // Chart long-press -> prefilled alert (canvas engine only; TradingChart
  // no-ops this entirely when the prop is absent, so desktop is unaffected).
  const handleAlertAtPrice = useCallback((price) => {
    setAlertPrefillPrice(price)
    setAlertOpen(true)
  }, [])
  const closeAlert = useCallback(() => {
    setAlertOpen(false)
    setAlertPrefillPrice(0)
  }, [])

  const tokenAlertCount = useTokenAlerts(alerts, token?.address, token?.networkId).length

  const overlaysOpen = drawerOpen || swapOpen || agentOpen || alertOpen

  // Straight to the Watchlist tab of the home shell (view-nav shortcut).
  const goWatchlist = useCallback(() => {
    try { sessionStorage.setItem(MHS_TAB_KEY, 'watchlist') } catch { /* private mode */ }
    onBack?.()
  }, [onBack])

  // DexScreener-style edge swipe-back: a touch starting at the left screen
  // edge dragged right returns to the home shell (which restores the tab the
  // user came from). Passive document listeners - never blocks chart pans;
  // touches starting on the draggable side rail (.msr) are ignored.
  const backRef = useRef(onBack)
  const overlaysRef = useRef(overlaysOpen)
  useEffect(() => { backRef.current = onBack }, [onBack])
  useEffect(() => { overlaysRef.current = overlaysOpen }, [overlaysOpen])
  useEffect(() => {
    let startX = 0
    let startY = 0
    let tracking = false
    let fired = false
    const onStart = (e) => {
      const t = e.touches?.[0]
      tracking = !!t && t.clientX <= 28 && !overlaysRef.current
        && !(e.target instanceof Element && e.target.closest('.msr'))
      fired = false
      if (t) { startX = t.clientX; startY = t.clientY }
    }
    const onMove = (e) => {
      if (!tracking || fired || overlaysRef.current) return
      const t = e.touches?.[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = Math.abs(t.clientY - startY)
      if (dx > 64 && dx > dy * 1.6) {
        fired = true
        backRef.current?.()
      }
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
    }
  }, [])

  // Lock body scroll while a drawer or sheet is open. Without this,
  // touch-scroll on the sheet propagates to the page underneath.
  useEffect(() => {
    if (overlaysOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [overlaysOpen])

  // Scroll back to the top of the page whenever the view changes so each
  // view starts at its head rather than mid-scroll from the previous one.
  useEffect(() => {
    const scroller = document.querySelector('.app')
    if (scroller) scroller.scrollTop = 0
    else window.scrollTo(0, 0)
  }, [view])

  // When user picks a new token from the drawer, close the drawer.
  const handleDrawerSelectToken = useCallback((next) => {
    selectToken?.(next)
    setDrawerOpen(false)
  }, [selectToken])

  return (
    <div className="mtp" data-testid="mobile-token-page" data-view={view}>
      {/* The global desktop Header renders above .mtp via App.jsx. */}

      {/* ── Pull-to-refresh wraps the whole page body (hero + views) so the
          pull travels from the very top, with the loader dropping from under
          the global header. The chart canvas is excluded — dragging there
          pans the chart, never the page. Social has no manual refetch →
          disabled there. */}
      <MobilePullRefresh
        onRefresh={handlePullRefresh}
        disabled={overlaysOpen || view === 'social'}
        excludeSelector=".mcc-chart-wrap, .mcc-resize"
      >
      {/* Compact identity + price + chips strip above every view. */}
      <MobilePriceHero
        token={token}
        watchlist={watchlist}
        addToWatchlist={addToWatchlist}
        removeFromWatchlist={removeFromWatchlist}
        onBack={onBack}
        alertCount={tokenAlertCount}
        onOpenAlerts={() => setAlertOpen(true)}
      />
      {(view === 'chart' || view === 'chart-txns') && (
        <MobileChartCard
          token={token}
          view={view}
          chartViewMode={chartViewMode}
          setChartViewMode={setChartViewMode}
          alertLines={alertLines}
          onAlertAtPrice={handleAlertAtPrice}
        />
      )}

      {view === 'chart-txns' && <MobileDataTabs token={token} registerRefresh={registerTradesRefresh} />}

      {view === 'info' && (
        <div className="mtp-view mtp-view--info">
          <MobileInfoBody token={token} embedded onTrade={() => openSwap('buy')} refreshTick={infoRefreshTick} />
        </div>
      )}

      {view === 'social' && (
        <div className="mtp-view mtp-view--social">
          <Suspense fallback={<div className="mtp-view-loading" aria-hidden="true" />}>
            <LeftPanel
              chartViewMode={chartViewMode}
              setChartViewMode={setChartViewMode}
              watchlist={watchlist}
              addToWatchlist={addToWatchlist}
              removeFromWatchlist={removeFromWatchlist}
              togglePinWatchlist={togglePinWatchlist}
              reorderWatchlist={reorderWatchlist}
              selectToken={selectToken}
              token={token}
              mobileSection="social"
            />
          </Suspense>
        </div>
      )}
      </MobilePullRefresh>

      {/* Bottom spacer so the two fixed bars (Buy/Sell + view nav) don't cover
          the last content row. */}
      <div className="mtp-dock-spacer" aria-hidden="true" />

      {/* Floating left-edge rail (draggable): a single Markets tab that opens
          the discovery drawer. Info is a bottom-nav view now. Hidden while any
          overlay is open (the rail portals to <body>). */}
      {!overlaysOpen && (
        <MobileSideRail onOpenDrawer={openDrawer} />
      )}

      {/* Bottom dock, stacked: Buy/Sell bar, then the view switcher below it. */}
      <MobileBottomNav
        onBuy={() => openSwap('buy')}
        onSell={() => openSwap('sell')}
      />
      <MobileViewNav
        active={view}
        onChange={setView}
        onTrade={() => openSwap('buy')}
        onWatchlist={goWatchlist}
      />

      {/* Spectre Agent launcher (draggable FAB). Hidden while any overlay open. */}
      <SpectreAgentFab
        mobile
        open={overlaysOpen}
        onOpen={openAgent}
        listening={wakeArmed}
      />

      {/* "Back to top" — hidden while any overlay is open. */}
      <MobileScrollTop hidden={overlaysOpen} />

      {/* Bottom sheet swap (renders only when open). */}
      <MobileSwapSheet
        open={swapOpen}
        onClose={closeSwap}
        token={token}
        mode={swapMode}
      />

      {/* Spectre Agent bottom sheet (renders only when open). */}
      <MobileAgentSheet
        open={agentOpen}
        onClose={closeAgent}
        token={token}
        onSelectToken={selectToken}
        peek={agentPeek}
        autoVoice={agentVoiceFirst}
      />

      {/* Price/mcap alert bottom sheet (renders only when open). */}
      <MobileAlertSheet
        open={alertOpen}
        onClose={closeAlert}
        token={token}
        alerts={alerts}
        rules={rules}
        createAlert={createAlert}
        updateAlert={updateAlert}
        deleteAlert={deleteAlert}
        initialPrice={alertPrefillPrice}
      />

      {/* Left drawer: the mobile Markets board. Closes itself on select. */}
      <MobileWatchlistDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        selectToken={handleDrawerSelectToken}
        watchlist={watchlist}
        addToWatchlist={addToWatchlist}
        removeFromWatchlist={removeFromWatchlist}
      />
    </div>
  )
}
