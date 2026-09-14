# Mobile Landing Page – Plan

## Goal
Optimize the **landing page (Welcome)** for mobile: bottom nav for main sections, clear content order (Welcome widget = Home first, rest lower), and Top coins values tuned for small screens.

---

## 1. Mobile bottom navigation

**When:** Viewport width ≤ 768px (or 767px, match existing media queries).

**Behavior:**
- **Hide or collapse** the left NavigationSidebar (or show as overlay/drawer only).
- **Show a fixed bottom bar** with 4 items (icons + short labels):

| Item        | Icon (concept)     | Action / content                          |
|------------|--------------------|--------------------------------------------|
| **Home**   | Home / layers      | Welcome widget first; scroll to rest of page |
| **Command center** | Grid / panels | Market AI widget (News, Analysis, Flows, etc.) – focus this section or open as sheet |
| **Favorites** | Star / heart   | Navigate to Watchlists page (existing)      |
| **Top coins** | Chart / list   | Scroll to Top Coins table or open Top Coins–focused view |

**Implementation notes:**
- Reuse existing routing: Home = `research-platform` + `currentView === 'welcome'`; Favorites = `watchlists`; Command center and Top coins are sections on the same Welcome page (scroll or tab).
- Bottom bar: `position: fixed; bottom: 0; left: 0; right: 0; z-index` above content; safe-area padding for home indicator; 4 equal-width items; active state for current section.
- Optional: “Command center” tap scrolls to `.welcome-market-ai-widget` or opens a bottom sheet with Market AI tabs. “Top coins” tap scrolls to Top Coins table or opens a compact Top Coins view.

---

## 2. Landing page content order (mobile)

**Current:** Sidebar + main + right panels (multi-column).

**Mobile:**
1. **Top:** Compact header (logo, profile, day mode if present) – minimal height.
2. **Primary:** **Welcome widget** (profile, quick stats, structure guide, etc.) – “Home” content first.
3. **Below:** Command center (Market AI: News, Analysis, Flows, …).
4. **Below:** Discovery / Top Coins section (tabs: Top Coins | On-Chain | Prediction Markets) and token list.
5. **Bottom:** Reserve space for bottom nav (e.g. `padding-bottom: 72px` on main scroll container).

So on mobile, “Home” = “see Welcome widget first”; “rest lower” = Command center and Top Coins follow in one scroll.

---

## 3. Command center (mobile)

- **Option A:** In-place: Market AI widget stays in scroll flow; “Command center” in bottom nav scrolls to it and optionally expands it.
- **Option B:** Sheet/modal: Tap “Command center” opens a bottom sheet with Market AI tabs (News, Analysis, Flows, Mindshare, Calendar, etc.); same content as desktop, stacked vertically.
- **Recommendation:** Start with Option A (scroll-to + in-place) for less scope; add sheet later if needed.

---

## 4. Favorites and Top coins

- **Favorites:** Bottom nav item “Favorites” → `onPageChange('watchlists')` (existing Watchlists page). Ensure WatchlistsPage is mobile-friendly (separate pass if needed).
- **Top coins:**  
  - Bottom nav item “Top coins” → scroll to Top Coins section on Welcome, or open a mobile “Top coins” view.  
  - **Top coins values optimized for mobile:**  
    - Use short formatting: e.g. `$42.1K`, `$1.2M`, `$3.4B`; percentages with 2 decimals or 1 when space is tight.  
    - Fewer columns on small width: e.g. Symbol, Price, 24h% (and optionally 7d% or Mcap); hide or move Volume/Mcap to detail row or “see more”.  
    - Font size and padding so numbers don’t wrap or overlap.  
    - Optional: horizontal scroll for table with a visible “scroll” hint; or card list for each coin instead of table.

---

## 5. Top coins values – mobile optimization (detailed)

| Element        | Desktop example | Mobile example / rule                    |
|----------------|-----------------|------------------------------------------|
| Price          | $97,234.56      | $97.2K or $97.2K (abbreviate above 1K)   |
| Market cap     | $1.92T          | $1.92T (keep T/M/B)                      |
| 24h %          | +2.34%          | +2.3% (2 decimals max)                  |
| Volume 24h     | $42.1B          | $42B or $42.1B (abbreviate)              |
| Table columns  | 6–8 columns     | 3–4: Symbol/Name, Price, 24h%, (optional 7d or Mcap) |

- Reuse or add a small formatter: `formatPriceShort(value)` / `formatCompact(value)` for prices and mcap on mobile.
- Apply via media query or a “compact” prop on the Top Coins table/list component.

---

## 6. Technical approach

1. **CSS**
   - Media query `(max-width: 768px)` (or 767px) for:
     - Bottom nav visible; sidebar hidden or overlay.
     - Single-column layout for Welcome: welcome widget → market AI → discovery/top coins.
     - Top coins table/list uses compact styles and abbreviated values.
   - Safe area: `padding-bottom: env(safe-area-inset-bottom)` for bottom nav; optional `env(safe-area-inset-top)` for header.

2. **React**
   - New component: `MobileBottomNav.jsx` (or `BottomNav.jsx`) with 4 items: Home, Command center, Favorites, Top coins.
   - Rendered only when `isMobile` (e.g. from `window.matchMedia('(max-width: 768px)')` or a hook).
   - Home → ensure `currentPage === 'research-platform'` and `currentView === 'welcome'`; scroll to top or to welcome widget.
   - Command center → scroll to `#command-center` or `.welcome-market-ai-widget`.
   - Favorites → `onPageChange('watchlists')`.
   - Top coins → scroll to `#top-coins` or `.welcome-topcoins-header-row` (or open dedicated view).

3. **IDs / refs**
   - Add `id="command-center"` to Market AI widget container and `id="top-coins"` to Top Coins section (or use refs) for scroll-into-view.

4. **State**
   - Optional: `mobileSection: 'home' | 'command-center' | 'favorites' | 'top-coins'` to highlight active bottom nav item when user scrolls (intersection observer) or when they tap.

---

## 7. Task list (implementation order)

| # | Task | Notes |
|---|------|--------|
| 1 | Add mobile breakpoint hook and bottom nav component | `useMediaQuery` or similar; `MobileBottomNav` with 4 items, fixed bottom, safe area |
| 2 | Wire bottom nav: Home, Command center, Favorites, Top coins | Home = welcome; Command center = scroll to Market AI; Favorites = watchlists page; Top coins = scroll to table |
| 3 | Landing layout: single column on mobile (welcome → command center → top coins) | CSS + optional reorder in DOM; reserve padding-bottom for nav |
| 4 | Hide or overlay left NavigationSidebar on mobile | When bottom nav visible, sidebar only via hamburger/overlay |
| 5 | Top coins: compact value formatting for mobile | formatPriceShort / formatCompact; use in Top Coins table when viewport is mobile |
| 6 | Top coins table: fewer columns / card list on mobile | Responsive table or list; 3–4 columns or stacked cards |
| 7 | Command center scroll target and optional “active” state | id/ref + scroll into view; optional intersection observer for bottom nav highlight |
| 8 | Polish: touch targets, header (top bar), safe areas | 44px targets; **top bar mobile**: safe-area-inset-top, compact layout, 44px nav/day/logo/search; padding for home indicator |

Start with **Task 1** and **Task 2** so the bottom nav exists and works; then **Task 3–4** for layout; then **Task 5–6** for Top coins values and layout; finally **7–8** for polish.
