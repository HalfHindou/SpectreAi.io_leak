# Trading Mobile Home — DexScreener-style Screener Shell

**Date:** 2026-07-16 · **Owner:** Evgeniy · **Approved by user in-session.**

## Goal
Replace the desktop DiscoverPage on mobile (`isMobile && currentView === 'welcome'`) with a
native DexScreener-style home: dense token screener + persistent bottom nav
(Screener · Search · Watchlist · Alerts · Menu). Desktop unchanged. Token page unchanged
(keeps its own MobileViewNav bar).

## Architecture
- `App.jsx`: welcome branch renders lazy `MobileHomeShell` when `isMobile`, else DiscoverPage.
- Global Header stays mounted (same as MobileTokenPage) — wallet/login access preserved.
- New folder `apps/trading/src/components/mobile/home/`:
  - `MobileHomeShell` (`mhs-`) — tab state, lazy-mounts screens on first visit, keeps them
    mounted afterward with scroll save/restore per tab.
  - `MobileHomeNav` (`mhn-`) — fixed bottom bar, 5 tabs, lucide icons, safe-area padding,
    watchlist/alerts count badges, warm-white active state.
  - `MobileScreener` (`msc-`) — category pills (Trending/New/Top/Gainers/Volume), 2 stat
    tiles (board volume + movers breadth), token list, sticky glass toolbar
    (timeframe · chain · sort) above the nav, sort/chain bottom sheets.
  - `MobileTokenRow` (`mrow-`) — shared row: 36px logo + chain dot, symbol + age chip +
    name, price + 1H/24H magnitude-graded changes, LIQ/VOL/MCAP chips. Live price flash.
    Swipe-right = watchlist toggle, swipe-left (watchlist context) = remove,
    long-press = peek card.
  - `MobileTokenPeek` (`mpk-`) — long-press bottom card: sparkline (synthetic via
    utils/sparkline), stat grid, Open / Watchlist actions.
  - `MobileSearchScreen` (`mss-`) — autofocus input, `useTokenSearch`, recent searches
    (localStorage `spectre-mobile-recent`), trending suggestions (cache-shared hook call).
  - `MobileWatchlistScreen` (`mwl-`) — watchlist entries + `useWatchlistLiveData`
    (fetchTokenDetailsBatch, 90s poll while tab active, document.hidden guard).
  - `MobileAlertsScreen` (`mal-`) — existing alerts list (name/direction/priceTarget),
    delete; empty state routes to screener.
  - `MobileMenuScreen` (`mmn-`) — Terminal (SPECTRE), Dashboard, Trending Hub, theme
    toggle (`spectre-color-mode` + `body.theme-light`), Research platform link, socials.

## Data (no new fetching layers)
- Screener: `useTrendingTokens(60000, CHAIN_NET_IDS[chain], timeframe)` + `useTopCoins`
  (enabled on Top tab) + `sortTokensByCategory`/`filterTokensByChain` from `marketFormat`.
- No pull-to-refresh in v1: hooks poll 60s and expose no manual refetch — a fake gesture
  would be dishonest.
- Watchlist: `fetchTokenDetailsBatch` (same source LeftPanel uses).
- Alerts: `alerts`/`deleteAlert` from App-level `useAlerts` passed down.

## Design language
Spectre warm-white cinematic, NOT DexScreener colors: numbers in `var(--font-num-chip)`
tabular-nums, color only on data (`--up`/`--down` with magnitude grading), glass ≤ blur(12px),
day mode via `body.theme-light` for every custom color, no emojis/spinners (shimmer skeletons).

## Out of scope
Desktop, token page, alert creation UI (stays on token page), pull-to-refresh, Most Visited tab.
