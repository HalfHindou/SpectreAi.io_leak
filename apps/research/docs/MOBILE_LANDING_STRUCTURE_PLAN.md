# Mobile Landing Page – Correct Structure & Plan

## 1. Landing page structure (one page, four sections)

The **landing page** is a single page (WelcomePage) with this layout:

**Desktop:** One row, three widgets side by side:
- **Left:** Welcome widget (profile, quick stats, Fear & Greed, etc.)
- **Center/right:** Command Center (Market AI: Analysis, News, Flows, etc.) – the **right widget next to** the welcome widget
- **Right:** Watchlist widget (watchlist on the landing page; “See All” goes to WatchlistsPage)

**Below that row:** Top Coins (discovery table).

So the **correct mental model**:
1. **Home** = Welcome widget first, then the rest (scroll to top).
2. **Command Center** = The right widget next to the welcome widget (scroll to it).
3. **Watchlists** = The watchlist **on the landing page** (scroll to it). Not the WatchlistsPage subpage.
4. **Top Coins** = Optimized top coins section (scroll to it).

Bottom nav does **not** navigate to WatchlistsPage; it scrolls to the **landing-page watchlist section**. Full WatchlistsPage is reached via “See All” inside the watchlist widget.

---

## 2. Mobile content order (stacked)

On mobile (≤768px), the same row stacks vertically. Order must be:

1. **Welcome widget** (first – “Home”)
2. **Command Center** (right widget next to welcome, second in stack)
3. **Watchlist** (landing-page watchlist, third)
4. **Top Coins** (optimized table, fourth)

Scroll container: `.welcome-page`. Bottom nav items scroll this container to the right section (or scroll the section into view within it).

---

## 3. Bottom nav behavior (corrected)

| Item | Action |
|------|--------|
| **Home** | Stay on landing; scroll `.welcome-page` to top → Welcome widget first, then rest. |
| **Command Center** | Stay on landing; scroll to `#command-center` (Command Center widget). |
| **Watchlists** | Stay on landing; scroll to `#watchlist` (landing-page watchlist widget). **Do not** navigate to WatchlistsPage. |
| **Top Coins** | Stay on landing; scroll to `#top-coins`. |

- Bottom nav is shown when on **research-platform** (landing) with **welcome** view.
- When user is on **WatchlistsPage** (e.g. from “See All”), bottom nav can still show: **Home** goes to landing; **Watchlists** goes to landing and scrolls to watchlist section.
- **activeId**: Home when at top/welcome; Command when command-center in view; Favorites when watchlist section in view; Top Coins when top-coins in view. (Can simplify to “home” whenever on landing until we have scroll-spy.)

---

## 4. Top bar (mobile) – optimization plan

**Goals:**
- Safe area (notch / status bar) respected; no content under notch.
- Touch targets ≥ 44px for all tappable elements.
- Compact but readable; minimal chrome so content has room.
- Day mode / theme consistent.

**Current:** Header has safe-area padding, 44px touch targets for nav toggle, day mode, logo, search; profile text and deposit label hidden on mobile.

**To optimize (tasks):**
- Reduce top bar height on mobile where possible (e.g. 64px content + safe area) without cramping.
- Ensure logo, nav toggle, search, day mode are in a single row; no wrap.
- Consider hiding or collapsing secondary items (e.g. weather/datetime) into a single “info” tap or move below fold on mobile.
- Ensure scrollable content has `scroll-margin-top` so sections aren’t hidden under the fixed header when scrolled into view.
- Test with notched devices (safe-area-inset-top).

---

## 5. Top Coins (mobile) – already targeted

- Fewer columns: e.g. #, Name, Price, 24H %, Mcap.
- Compact formatting: `formatPriceShort`, `formatLargeNumberShort`.
- Min-width/ellipsis so values don’t smudge; readable font size.
- Horizontal scroll only if needed, with visible affordance.

---

## 6. IDs and scroll targets

| Section | DOM / ID |
|---------|----------|
| Welcome widget | Start of `.welcome-page` (scroll top) or add `id="welcome"` on `.welcome-panel-wrap` |
| Command Center | `id="command-center"` on `.welcome-market-ai-widget` ✓ |
| Watchlist (landing) | Add `id="watchlist"` on `.welcome-watchlist-panel-wrap` (or wrapper) |
| Top Coins | `id="top-coins"` on discovery header ✓ |

---

## 7. Task list (implementation order)

### A. Structure & bottom nav behavior
- **T1** Add `id="watchlist"` to the landing-page watchlist section in WelcomePage (e.g. on `.welcome-watchlist-panel-wrap` or its first child).
- **T2** Change mobile bottom nav “Watchlists” handler: do **not** call `handlePageChange('watchlists')`. Instead: `setCurrentPage('research-platform')`, `navigateTo('welcome')`, then scroll to `#watchlist` (same pattern as Command Center / Top Coins). Ensure bottom nav still shows when on WatchlistsPage so user can go Home or Watchlists (landing section).
- **T3** Ensure mobile stack order in WelcomePage CSS is: Welcome → Command Center → Watchlist → (below row) Top Coins. Confirm `grid-template-rows: auto auto auto` and order of children in `.welcome-sidebar-row`.
- **T4** (Optional) Add `id="welcome"` to welcome section for explicit scroll target; keep Home scrolling `.welcome-page` to top.

### B. Top bar optimization
- **T5** Review Header mobile CSS: reduce vertical padding/height if possible (e.g. 64px content height + safe-area-inset-top) while keeping 44px touch targets.
- **T6** Ensure header left-to-right: nav toggle, logo, search, day mode (and any kept secondary) fit one row without wrap; hide or collapse weather/datetime on mobile if needed.
- **T7** Add or verify `scroll-margin-top` on `#watchlist`, `#command-center`, `#top-coins` so fixed header doesn’t cover section titles when scrolling.
- **T8** Test on notched viewport; confirm safe-area-inset-top is applied to header and that `.welcome-page` padding-top accounts for header + safe area.

### C. Top Coins & polish
- **T9** Verify Top Coins mobile: columns (#, Name, Price, 24H %, Mcap), compact formatters, no smudged values.
- **T10** Bottom nav activeId: when on landing, set activeId from scroll position (e.g. “home” when near top, “command-center” when that section in view, etc.) or leave as “home” whenever on welcome view until scroll-spy is added.

---

## 8. Summary

- **One landing page**, four sections: Welcome → Command Center → Watchlist (on page) → Top Coins.
- **Bottom nav** = scroll to section on landing; Watchlists = landing watchlist section, **not** WatchlistsPage.
- **Top bar** = compact, safe area, 44px targets, scroll-margin for sections.
- **Tasks T1–T10** above implement and polish this.

---

## 9. Task checklist (for implementation)

| ID | Task | Status |
|----|------|--------|
| T1 | Add `id="watchlist"` to landing-page watchlist section (WelcomePage) | ⬜ |
| T2 | Bottom nav Watchlists: scroll to `#watchlist` on landing; do not navigate to WatchlistsPage | ⬜ |
| T3 | Confirm mobile stack order: Welcome → Command Center → Watchlist → Top Coins | ⬜ |
| T4 | (Optional) Add `id="welcome"` to welcome section | ⬜ |
| T5 | Header mobile: reduce height if possible; keep 44px touch targets | ⬜ |
| T6 | Header mobile: single row (nav, logo, search, day mode); hide/collapse weather-datetime if needed | ⬜ |
| T7 | Add/verify `scroll-margin-top` on `#watchlist`, `#command-center`, `#top-coins` | ⬜ |
| T8 | Test safe-area (notch); header + welcome-page padding | ⬜ |
| T9 | Verify Top Coins mobile: columns + compact formatting | ⬜ |
| T10 | Bottom nav activeId: home when landing, or scroll-spy later | ⬜ |
