# Mobile Explore redesign — Social | Markets split

**Date:** 2026-07-15
**Owner:** Evgeniy
**App:** `apps/trading/` (mobile "Explore" bottom sheet)
**Scope:** mobile only. Desktop `LeftPanel` / `TokenScreener` behavior must stay identical.

---

## Problem

The mobile "Explore" bottom sheet (`MobileWatchlistDrawer`) mounts the **entire desktop `LeftPanel`** verbatim. `LeftPanel` internally stacks two unrelated card blocks:

- `main-feed` (`LeftPanel.jsx:1675`) — icon tabs (𝕏 / Watchlist / AI-locked / X-Dash / Social-locked), `Project Posts / Replies / Community / KOLs / All` filter chips, and the X post feed.
- `bottom-section` (`LeftPanel.jsx:2409`) — `<TokenScreener/>`, an already-rich token discovery list.

On a phone this reads as one dense, low-contrast wall: two tab systems stacked, a social feed and a token screener with no top-level "what am I looking at", huge post images, near-invisible engagement counts, and a duplicated "Trending" concept (a Trending section inside the feed **and** the Trending category inside the screener, each with its own chain filter).

## Decisions (locked with user)

1. **Structure:** top-level segmented control **Markets | Social**. One section visible at a time.
2. **Default:** opens on **Markets** every time (not remember-last).
3. **Token rows:** rich row — logo + name, prominent price and %, muted `Vol · MC · age` line, sparkline kept.
4. **Token name:** add full name (e.g. "Solana") but render it **mobile-only**; the desktop rail is unchanged.
5. **Implementation:** Approach A — a `mobileSection` prop on `LeftPanel`; no code extraction, desktop untouched.

## Approach A (chosen)

Add an optional `mobileSection` prop (`'markets' | 'social'`) to `LeftPanel`:

- When set, `LeftPanel` renders **only** the matching card: `'markets'` → `bottom-section` (screener); `'social'` → `main-feed` (feed + its sub-tabs).
- When absent (desktop token page), both cards render exactly as today. **Zero desktop change** — this is the key safety property.

`MobileWatchlistDrawer` owns the `Markets | Social` segmented control (default `'markets'`, local `useState`, reset to `'markets'` on each open) and passes the selection down as `mobileSection`.

Rejected alternatives:
- **B — standalone `MobileExplore.jsx` + extracted `SocialFeed`:** cleaner separation but requires lifting ~200 lines of feed JSX and all its state/hooks out of the 2605-line `LeftPanel` — high effort, real regression risk. Not worth it for a visual pass.
- **C — CSS-only tidy, no structure change:** user rejected; leaves the two-worlds confusion.

## Markets section (default view)

- **Deduplicate Trending:** the feed-side Trending block is not rendered in the mobile Markets view (only the screener's own Trending category + single chain filter remain). One category row, one chain filter.
- **Rich rows:** reflow `TokenScreener` rows for mobile readability — logo + ticker + **name** (mobile-only), price and % as the prominent pair, `Vol · MC · age` muted below, sparkline retained. Bigger tap target / more vertical breathing room.
- **Name rendering:** add a name node to the row DOM; keep it hidden on desktop (CSS-scoped to the mobile drawer, e.g. `.mwd-body .screener-row-name`, or gated by a prop). No change to desktop layout.
- Keep pagination, sort dropdown, timeframe segmented control, chain pills, category pills, filters, and the list/heatmap view toggle.

## Social section (via toggle)

- Keep the existing feed sub-tabs (𝕏 posts / Watchlist / X-Dash) — no feature loss.
- **Post card readability pass:** raise text contrast to the design-system ramp; cap embedded image height (currently near-full-screen) with `max-height` + `object-fit: cover`; make the engagement row (reply / repost / like / views) legible instead of grey-on-grey; tighten spacing.
- Remove the desktop-only "Full View" button from the mobile feed header (on mobile it only throws a "desktop-only" toast).

## Files touched

- `apps/trading/src/components/mobile/MobileWatchlistDrawer.jsx` — segmented control + `mobileSection` state, pass prop.
- `apps/trading/src/components/mobile/MobileWatchlistDrawer.css` — segmented control styling, Markets/Social layout polish.
- `apps/trading/src/components/LeftPanel.jsx` — accept `mobileSection`; conditionally render one card when present (desktop path unchanged). Post-card readability tweaks (image cap, engagement counts) scoped to mobile.
- `apps/trading/src/components/LeftPanel.css` — mobile-scoped post-card + feed rules.
- `apps/trading/src/components/TokenScreener.jsx` — add mobile-only name node to the row.
- `apps/trading/src/components/TokenScreener.css` — mobile-scoped rich-row reflow + name visibility.

## Day mode

Trading app day mode = `body.theme-light` (NOT `.app.app-day-mode`). Every new mobile rule needs a `body.theme-light` counterpart. Reuse existing `--up` / `--down` / `--text-*` tokens; no new hues (Spectre trading is black & white — color only as market semantics).

## Out of scope

- No desktop `LeftPanel` / `TokenScreener` behavior or layout change.
- No data-layer / hook / endpoint changes (rows already carry name, price, %, vol, mcap, age, sparkline, buy/sell flow).
- No new "Watchlist" top-level segment — watchlist stays a sub-tab inside Social.

## Success criteria

1. Explore opens on Markets; one clear section at a time; `Markets ⇄ Social` toggle is obvious.
2. Token rows are scannable — price/% prominent, Vol·MC·age muted, name visible on mobile.
3. No duplicated Trending / double chain filter in the mobile view.
4. Social posts are readable — capped images, visible engagement counts, contrast up.
5. Desktop token page (LeftPanel + TokenScreener) is pixel-identical to before.
6. `npm run build:trading` clean; day mode correct in both sections.
