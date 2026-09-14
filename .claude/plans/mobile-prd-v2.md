# Spectre AI — Mobile PRD v2

## Core Principle

**DO NOT REBUILD. ADAPT.**

Every desktop component already exists and looks premium. The mobile system's job is to make those same components render correctly at 375px width. Same icons. Same shades. Same fonts. Same glass surfaces. Same data. Just responsive.

---

## Desktop Audit Summary

### What the desktop home page renders (top to bottom):

```
┌─────────────────────────────────────────────────────────────────┐
│ APP SHELL                                                       │
│ ┌──────┐ ┌────────────────────────────────────────────────────┐ │
│ │ NAV  │ │ HEADER: Logo | Search | Clock | Weather | Market   │ │
│ │ SIDE │ │         Mode | Day/Night | Cinema/Terminal | Profile│ │
│ │ BAR  │ ├────────────────────────────────────────────────────┤ │
│ │      │ │ TOKEN TICKER BAR (scrolling prices / news)         │ │
│ │ 8    │ ├────────────────────────────────────────────────────┤ │
│ │ grps │ │ BREAKING NEWS BANNER (conditional, red pulse)      │ │
│ │      │ ├────────────────────────────────────────────────────┤ │
│ │ 30+  │ │ HORIZONTAL BAR (collapsible)                       │ │
│ │ items│ │ [Profile][MCap][BTC][SOL][ETH][F&G Gauge]          │ │
│ │      │ │ [Dominance Donut][US Market][Econ Event]           │ │
│ │      │ ├────────────────────────────────────────────────┬───┤ │
│ │      │ │ COMMAND CENTER (75%)              │ WATCHLIST  │   │ │
│ │      │ │ 10 tabs: Brief|Analysis|News|     │ (25%)     │   │ │
│ │      │ │ Heatmap|Liq|Sectors|Mindshare|    │ Search    │   │ │
│ │      │ │ Calendar|Flows|Wallets            │ Token rows│   │ │
│ │      │ ├───────────────────────────────────┴───────────┤   │ │
│ │      │ │ DISCOVERY SECTION                              │   │ │
│ │      │ │ Tabs: TopCoins|OnChain|Predictions|AIAgents|   │   │ │
│ │      │ │       AIModels|WarRoom                         │   │ │
│ │      │ │ Table with: rank, logo, name, price, change,   │   │ │
│ │      │ │ mcap, volume, sparkline, watchlist btn          │   │ │
│ └──────┘ └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Desktop Navigation (30+ pages in 8 groups):

```
Home:     Research Platform, Monarch AI, YOU
Research: Discover, Ventures, Intelligence, News, Research Zone, Search Engine
Trading:  AI Screener, Trader's Corner, Liquidation Heatmap
Analysis: AI Charts, AI Charts Lab, AI Market Analysis, Economic Calendar
Visualize: Heatmaps, Bubbles, Fear & Greed
Social:   Social Zone, AI Media Center, X Dash, X Bubbles, X Bubble Maps
Tools:    Watchlists, Categories, Glossary, Lens
Account:  User Dashboard, Structure Guide
```

---

## Mobile Strategy: Responsive, Not Rebuilt

### Rule 1: Same Components, CSS Overrides Only

Every desktop component that renders on the home page MUST render on mobile too. The mobile code path should:
- Import the SAME component
- Apply mobile CSS overrides via `@media (max-width: 768px)` or scoped `.mh-container` parent
- Adjust layout (flex-direction, grid columns, font sizes, padding)
- NEVER rebuild a component from scratch for mobile

### Rule 2: Same Data, Same Hooks

Mobile uses the exact same data hooks as desktop. No new API calls. No mock data. No "simplified" versions.

### Rule 3: Same Visual Language

If desktop uses `rgba(255,255,255,0.04)` borders, mobile uses `rgba(255,255,255,0.04)` borders. If desktop uses `var(--font-mono)` for prices, mobile uses `var(--font-mono)` for prices. Zero visual divergence.

---

## Mobile Layout Architecture

### Navigation Layer

```
┌──────────────────────────────────────────┐
│ MOBILE HEADER (52px + safe-area)         │
│ [☰] [SPECTRE logo] [Crypto|Stocks] [☀️] [🔍]│
├──────────────────────────────────────────┤
│                                          │
│  PAGE CONTENT (scrollable)               │
│                                          │
├──────────────────────────────────────────┤
│ BOTTOM NAV (glass pill, 5 tabs)          │
│ [Home] [Markets] [Intel] [Watchlist] [MC]│
└──────────────────────────────────────────┘
```

**Already exists and works:**
- `MobileHeader` → hamburger, logo image, crypto/stocks toggle, day/night, search
- `MobileBottomNav` → 5 tabs with glass orb design
- `SideDrawer` → slides from left, all nav groups
- `MobileSearchOverlay` → full-screen search
- `MissionControlSheet` → bottom sheet with Apple-style icon grid (for "MC" tab)

**No changes needed to navigation layer.** It's done.

### Bottom Nav Tab Mapping

| Tab | Route | Page Component |
|-----|-------|---------------|
| Home | `/` | WelcomePage (mobile path) |
| Markets | `/discover` | DiscoverPage |
| Intel | `/research-zone/bitcoin` | ResearchZonePage |
| Watchlist | `/watchlists` | WatchlistsPage |
| MC | (sheet) | MissionControlSheet (icon grid → page navigation) |

### Side Drawer Contents (hamburger menu)

Keep the existing grouped nav structure. All 30+ pages accessible. The side drawer already has this — no changes needed.

---

## Home Page Mobile Layout (the main work)

The home page mobile path (`isMobile` branch in `welcome-page.jsx`) should render **the same desktop components** in a vertical stack, with CSS overrides for mobile sizing.

### Section-by-Section Plan

Each section below maps a DESKTOP component to its MOBILE rendering. The component is the SAME — only layout/sizing changes.

---

#### Section 1: Horizontal Bar → Compact Stats Band

**Desktop:** `InlineHorizontalBar` — horizontal flex of profile, MCap, 3 price cards, F&G gauge, dominance donut, US market, econ event

**Mobile approach:** Render the SAME `InlineHorizontalBar` component but with mobile CSS overrides:
- Wrap to vertical stack or horizontal scroll
- Profile section: greeting text only (name from Zustand), no edit button
- Price cards: 3 across, compact (current implementation works)
- F&G gauge: inline value + classification (no SVG arc on mobile — too small)
- Dominance: stacked bar (current implementation works)
- US Market: compact badge
- Econ Event: single line

**CSS strategy:** Add `@media (max-width: 768px)` overrides to `inline-horizontal-bar.css`. The component already has responsive-friendly class names.

**Alternative if InlineHorizontalBar is too complex:** Extract its data and render simplified versions of each panel. But use the SAME CSS class names from the desktop widgets so visual consistency is maintained.

---

#### Section 2: Command Center → Vertical Tabs + Content

**Desktop:** Command Center widget with 10-tab bar + content area (75% width)

**Mobile approach:** Render the SAME `CommandCenter` component (or the inline CC from `welcome-page.jsx`) with mobile overrides:
- Tab bar: horizontal scroll (already works in tight spaces)
- Content: full-width
- Hide the "Full View" and "Share" buttons on mobile (or move to overflow menu)

**CSS strategy:** `.welcome-market-ai-widget` gets `width: 100%` on mobile. Tab icons smaller. Content area full-bleed.

---

#### Section 3: Watchlist → Full-Width Token List

**Desktop:** `InlineWatchlistPanel` (25% width sidebar)

**Mobile approach:** Render watchlist tokens as full-width rows. Reuse `InlineWatchlistPanel` or `WatchlistPanel` component with mobile CSS:
- Full width
- Hide search bar (use global search instead)
- Token rows: logo + name + price + change + sparkline
- "View All" link → navigates to `/watchlists`
- Show 5 tokens max, truncate with "View all N tokens"

---

#### Section 4: Discovery Section → Simplified Token Table

**Desktop:** `DiscoverySection` with 6 tabs, category filters, view modes, pagination

**Mobile approach:** Render a simplified version:
- Tab bar: horizontal scroll with same 6 tabs
- Category pills: horizontal scroll
- Table: simplified to essential columns only (rank, logo+name, price, change, sparkline)
- Hide: volume, mcap columns (available on tap/drill-down)
- No grid mode on mobile (list only)
- Pagination: simple "Load more" button instead of page numbers

**CSS strategy:** Override `.welcome-discovery-*` classes for mobile widths.

---

#### Section 5: Token Ticker → Keep As-Is

**Desktop:** Scrolling `TokenTicker` bar at top

**Mobile:** Same component, same scroll behavior. May need smaller font. Already works well at small widths since it's a horizontal scroller.

---

#### Section 6: Breaking News Banner → Keep As-Is

**Desktop:** Red pulsing dot + headline

**Mobile:** Same component, full width. Already compact enough. Just ensure text truncates with ellipsis.

---

### Mobile Home Page Render Order

```
1. Token Ticker (scrolling prices — same component)
2. Breaking News Banner (conditional — same component)
3. Horizontal Bar (profile + stats — same component, mobile CSS)
   └── Greeting + Market Pulse stats
   └── 3 Price Cards (BTC/SOL/ETH)
   └── F&G + Alt Season (side by side)
   └── Dominance bar
   └── US Market badge
4. Command Center (10 tabs — same component, mobile CSS)
5. Watchlist (5 tokens — same component, mobile CSS)
6. Discovery (Top Coins table — same component, mobile CSS)
```

This mirrors the desktop EXACTLY. Same order. Same data. Same components. Just stacked vertically.

---

## Subpage Mobile Strategy

### Pages That Already Work on Mobile

Most pages inside `PageShell` already have some responsive CSS. The strategy for each:

| Page | Mobile Strategy |
|------|----------------|
| `/discover` | Already has mobile CSS. Verify and fix any overflow issues. |
| `/watchlists` | Already has swipeable rows, bottom sheet. Mobile-first design exists. |
| `/research-zone` | Has `MobileTabBar` component. Verify layout at 375px. |
| `/intelligence` | 3-column → single column stack. Hero story full-width. |
| `/news` | Article list → single column. Already simple layout. |
| `/fear-greed` | Chart needs responsive canvas sizing. |
| `/heatmaps` | Grid needs responsive cell sizing. |
| `/categories` | Card grid → 2 columns on mobile. |
| `/economic-calendar` | Table → card list on mobile. |
| `/search-engine` | Already has responsive search UI. |
| `/monarch-chat` | 3-column → single column with bottom input. |

### Pages That Need Mobile Work

| Page | Issue | Fix |
|------|-------|-----|
| `/token` | iframe to trading app — needs its own mobile handling | Trading app handles its own responsive |
| `/traders-corner` | `react-grid-layout` drag grid — unusable on mobile | Show as vertical stack of widgets, no drag |
| `/you` | Same react-grid-layout issue | Same — vertical stack |
| `/ai-charts`, `/ai-charts-lab` | Chart sizing | Responsive canvas/chart width |
| `/bubbles` | Canvas visualization | Touch-friendly, responsive sizing |
| `/liquidation-heatmap` | Canvas with pan/zoom | Touch gestures for pan/zoom |

### Pages That Can Be Deprioritized for Mobile

These are desktop-power-user features. They should be accessible (via Side Drawer / MC Sheet) but don't need special mobile optimization:

- `/x-dash`, `/x-bubbles`, `/x-bubble-maps`
- `/ai-media-center`
- `/social-zone`
- `/ventures`
- `/glossary`
- `/structure-guide`
- `/roi-calculator`

---

## Implementation Phases

### Phase 1: Home Page — Desktop Components at Mobile Widths (THE PRIORITY)

**Goal:** The mobile home page renders the SAME components as desktop, just responsive.

**Files to modify:**
1. `welcome-page.jsx` — The `isMobile` branch. Instead of rendering `MobileHomeTab`, render the SAME desktop sections with a `mobile-home` wrapper class
2. `inline-horizontal-bar.css` — Add `@media (max-width: 768px)` responsive overrides
3. `welcome-page.css` — Add mobile overrides for Command Center, Discovery, etc.
4. `inline-watchlist-panel.css` — Mobile full-width override

**Files to NOT modify:**
- Component JSX files (they stay the same)
- Data hooks
- Icon definitions

**Approach:**
- Wrap the same desktop JSX in a `<div className="mobile-home-wrapper">`
- Use CSS-only overrides to reflow layout for 375px
- Every desktop CSS class gets a corresponding mobile override

### Phase 2: Navigation Polish

- Verify Side Drawer has all 30+ pages accessible
- Verify MissionControlSheet maps to correct pages
- Verify bottom nav active states for all pages
- Add "Back to Home" gesture (tap Home tab when already on home → scroll to top)

### Phase 3: Subpage Responsive Passes

For each CRITICAL/HIGH page:
1. Load at 375px width
2. Identify overflow, cut-off, or broken layout
3. Add CSS `@media` overrides
4. Verify touch targets ≥ 44px

Priority order:
1. `/discover` (Markets tab)
2. `/watchlists` (Watchlist tab)
3. `/research-zone` (Intel tab)
4. `/intelligence`
5. `/news`
6. `/fear-greed`
7. `/heatmaps`
8. `/economic-calendar`

### Phase 4: Polish

- Verify all day mode counterparts
- Safe area insets (notch + home indicator)
- Scroll performance (reduce backdrop-filter on mobile)
- Touch feedback on all interactive elements
- Loading states (shimmer skeletons, not spinners)

---

## What NOT To Do

1. ❌ Do NOT create new mobile-specific components (e.g., `MobileBriefCard`, `MobileMarketPulse`)
2. ❌ Do NOT create new CSS files for mobile-only components
3. ❌ Do NOT simplify data (show same metrics as desktop)
4. ❌ Do NOT change colors, fonts, opacities, or border radiuses
5. ❌ Do NOT add mobile-only animations or interactions
6. ❌ Do NOT rebuild the icon grid / Mission Control inline on the home page
7. ❌ Do NOT create "card" versions of components that are "rows" on desktop (or vice versa)

## What TO Do

1. ✅ Use `@media (max-width: 768px)` CSS overrides on EXISTING component stylesheets
2. ✅ Use the same JSX render path (or minimal branching) for mobile
3. ✅ Stack components vertically that are side-by-side on desktop
4. ✅ Make horizontal elements scroll horizontally (tabs, category pills, ticker)
5. ✅ Reduce font sizes proportionally (not arbitrarily)
6. ✅ Hide non-essential controls (full-view buttons, compare mode) with `display: none` on mobile
7. ✅ Ensure touch targets are ≥ 44px
8. ✅ Test at 375px (iPhone SE), 390px (iPhone 14), 428px (iPhone 14 Pro Max)

---

## Current State Assessment

### What's already done and working:
- ✅ MobileHeader (logo, toggles, search, hamburger)
- ✅ MobileBottomNav (5 tabs, glass design)
- ✅ SideDrawer (full nav, all groups)
- ✅ MobileSearchOverlay (full-screen search)
- ✅ MissionControlSheet (Apple icon grid, bottom sheet)
- ✅ Page routing from bottom nav
- ✅ Day mode support on nav elements

### What needs to be redone (Phase 1):
- ❌ `MobileHomeTab` component — currently rebuilds everything from scratch
- **Fix:** Delete `MobileHomeTab`. Make the `isMobile` branch in `welcome-page.jsx` render the SAME desktop components with a mobile CSS wrapper class

### What already works for subpages:
- ✅ Discover page has some mobile CSS
- ✅ Watchlists page has mobile swipe rows
- ✅ Research Zone has MobileTabBar

---

## Key Files Reference

```
NAVIGATION (done, no changes):
  src/components/mobile-header.jsx + .css
  src/components/mobile-bottom-nav.jsx + .css
  src/components/side-drawer.jsx + .css
  src/components/mobile-search-overlay.jsx + .css
  src/components/mission-control-sheet.jsx + .css

HOME PAGE (Phase 1 work):
  src/pages/home/components/welcome-page.jsx        ← modify isMobile branch
  src/pages/home/components/welcome-page.css         ← add @media overrides
  src/pages/home/components/inline-horizontal-bar.jsx + .css  ← add mobile CSS
  src/pages/home/components/inline-watchlist-panel.jsx + .css  ← add mobile CSS
  src/pages/home/components/discovery-section.jsx + .css       ← add mobile CSS
  src/pages/home/components/command-center.jsx + .css          ← verify mobile CSS

SUBPAGES (Phase 3):
  src/pages/discover/components/ + CSS
  src/pages/watchlists/components/ + CSS
  src/pages/research-zone/components/ + CSS
  src/pages/intelligence/components/ + CSS
  etc.
```
