/**
 * MobileHomeShell — the mobile home of the trading app (prefix mhs-).
 *
 * Replaces the desktop DiscoverPage on phones: a DexScreener-style tab shell
 * with a persistent bottom nav. Five screens: Screener · Search · Watchlist ·
 * Alerts · Menu. Screens lazy-mount on first visit and STAY mounted after —
 * inactive screens are stacked with `visibility: hidden` (not display:none),
 * so each tab keeps its own scroll position and state for free.
 *
 * The global fixed Header stays above (same contract as MobileTokenPage);
 * the shell clears it with padding-top.
 */
import React, { useState, useCallback } from 'react'
import MobileHomeNav from './MobileHomeNav'
import MobileScreener from './MobileScreener'
import MobileSearchScreen from './MobileSearchScreen'
import MobileWatchlistScreen from './MobileWatchlistScreen'
import MobileAlertsScreen from './MobileAlertsScreen'
import MobileMenuScreen from './MobileMenuScreen'
import './MobileHomeShell.css'

/* The shell unmounts while a token page is open - remember the active tab so
   backing out of a token returns to the tab the user left (watchlist ->
   token -> back lands on watchlist, not the screener). The token page's
   view-nav Watchlist shortcut writes this key too - it imports the constant
   from lib/mobileHomeTab so it does NOT pull this whole shell (and its five
   screens) into its own chunk. Re-exported here for existing importers. */
import { MHS_TAB_KEY } from '../../../lib/mobileHomeTab'
export { MHS_TAB_KEY }
const TAB_IDS = new Set(['screener', 'search', 'watchlist', 'alerts', 'menu'])

function readSavedTab() {
  try {
    const t = sessionStorage.getItem(MHS_TAB_KEY)
    return TAB_IDS.has(t) ? t : 'screener'
  } catch { return 'screener' }
}

/* The token the user was last on, for the bottom-nav shortcut. App.jsx writes
   this on every selectToken; the key is absent until a token has actually been
   opened, which is exactly the "has a previous token" test the nav needs.
   Read at mount: the shell unmounts while a token page is open, so coming
   back from a token always re-reads. */
function readLastToken() {
  try {
    const t = JSON.parse(localStorage.getItem('spectre-selected-token') || 'null')
    return t && t.address && t.symbol ? t : null
  } catch { return null }
}

export default function MobileHomeShell({
  selectToken,
  navigateTo,
  watchlist,
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
  alerts,
  rules,
  updateAlert,
  deleteAlert,
  triggered,
  deleteTriggered,
  unseenAlerts,
  markAlertsSeen,
}) {
  const [active, setActive] = useState(readSavedTab)
  const [visited, setVisited] = useState(() => new Set([readSavedTab()]))
  const [lastToken] = useState(readLastToken)

  const switchTab = useCallback((id) => {
    // Not a tab - the nav's contextual slot routes back to the last token.
    if (id === 'token') {
      if (lastToken) selectToken?.(lastToken, 'mobile-nav-last-token')
      return
    }
    setVisited(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
    setActive(id)
    // Screens stay mounted after first visit, so the alerts screen's mount
    // effect fires only once - clear the unseen watermark on every re-open here.
    if (id === 'alerts') markAlertsSeen()
    try { sessionStorage.setItem(MHS_TAB_KEY, id) } catch { /* private mode */ }
  }, [markAlertsSeen, lastToken, selectToken])

  const goScreener = useCallback(() => switchTab('screener'), [switchTab])

  const screen = (id, node) => (
    visited.has(id) && (
      <section
        key={id}
        className={`mhs-screen${active === id ? ' is-active' : ''}`}
        aria-hidden={active !== id}
      >
        {node}
      </section>
    )
  )

  return (
    <div className="mhs">
      <div className="mhs-screens">
        {screen('screener', (
          <MobileScreener
            active={active === 'screener'}
            selectToken={selectToken}
            isInWatchlist={isInWatchlist}
            addToWatchlist={addToWatchlist}
            removeFromWatchlist={removeFromWatchlist}
          />
        ))}
        {screen('search', (
          <MobileSearchScreen
            active={active === 'search'}
            selectToken={selectToken}
            isInWatchlist={isInWatchlist}
            addToWatchlist={addToWatchlist}
            removeFromWatchlist={removeFromWatchlist}
          />
        ))}
        {screen('watchlist', (
          <MobileWatchlistScreen
            active={active === 'watchlist'}
            watchlist={watchlist}
            selectToken={selectToken}
            removeFromWatchlist={removeFromWatchlist}
            onGoScreener={goScreener}
          />
        ))}
        {screen('alerts', (
          <MobileAlertsScreen
            alerts={alerts}
            rules={rules}
            updateAlert={updateAlert}
            deleteAlert={deleteAlert}
            triggered={triggered}
            deleteTriggered={deleteTriggered}
            onSeen={markAlertsSeen}
            selectToken={selectToken}
            onGoScreener={goScreener}
          />
        ))}
        {screen('menu', (
          <MobileMenuScreen
            navigateTo={navigateTo}
            selectToken={selectToken}
            onOpenAlerts={() => switchTab('alerts')}
            alertsCount={unseenAlerts}
          />
        ))}
      </div>

      <MobileHomeNav
        active={active}
        onChange={switchTab}
        watchlistCount={watchlist?.length || 0}
        alertsCount={unseenAlerts}
        lastToken={lastToken}
      />
    </div>
  )
}
