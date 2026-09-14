# Spectre Vibe – What’s Done & What’s Next

Planning doc for continuing the app with Claude: **done so far**, **current structure**, and **rest of app** to plan and build.

---

## 1. What we’ve done so far

### 1.1 Mobile landing (Welcome page)

- **`useMediaQuery`** (`src/hooks/useMediaQuery.js`): `useIsMobile()` for viewport ≤ 768px.
- **`MobileBottomNav`** (`src/components/MobileBottomNav.jsx` + `.css`): Fixed bottom bar, 4 items:
  - **Home** → Welcome widget (scroll to top of welcome content).
  - **Command** → Scroll to Command Center (Market AI widget).
  - **Watchlists** → Navigate to Watchlists page.
  - **Top Coins** → Scroll to Top Coins section.
- **App integration**: Bottom nav shown when `isMobile && (currentPage === 'research-platform' || currentPage === 'watchlists')`. `onHome` / `onCommandCenter` / `onTopCoins` use `setCurrentPage('research-platform')`, `navigateTo('welcome')`, and scroll the right container or section.
- **Home button fix**: Welcome content scrolls inside `.welcome-page` (overflow-y: auto), not the window. **onHome** now scrolls `document.querySelector('.welcome-page')` to top (with short delay), so Home shows the welcome widget.
- **WelcomePage.css (mobile)**:
  - Top padding for fixed header + safe area; `scroll-margin-top` on `#command-center` and `#top-coins`.
  - `.welcome-sidebar-row` stacks vertically on mobile; welcome + watchlist + command center forced visible (override closed state).
  - Toggles for welcome/watchlist hidden on mobile; min-heights on panels; welcome widget has internal scroll.
- **Top Coins (mobile)**: Fewer columns, compact values; `formatPriceShort` / `formatLargeNumberShort` in `codexApi.js`; used in WelcomePage when `isMobile`.
- **Header (mobile)**: Safe area, 44px touch targets; simplified (e.g. hide deposit label, profile text).
- **App.css**: `padding-bottom` on main content when bottom nav visible; no sidebar margin shift on mobile so content doesn’t sit under nav.

### 1.2 Docs and plans already in repo

- **`docs/MOBILE_AGENT_PLAN.md`** – Mobile-first principles, checklist, breakpoints.
- **`docs/MOBILE_LANDING_PLAN.md`** – Bottom nav, content order, Command center / Top coins behavior.
- **`docs/APP_STRUCTURE.md`** – Routes, pages, components, file map (canonical reference).
- **`docs/RESEARCH_ZONE_LITE_PLAN.md`** – Research Zone LITE layout (CMC-style).
- **`docs/MONARCH_AT_UX_AND_AGENT_PLAN.md`** – @ project UX and agent reliability.
- Plus: API_PLAN, SETUP_APIS, FEAR_GREED_PAGE_PLAN, WELCOME_PAGE_DAY_MODE_PLAN, RESEARCH_ZONE_DAY_MODE_PLAN, SPECTRE_GLASS_UI_TASKS, etc.

---

## 2. Current app structure (short)

- **Entry**: `src/main.jsx` → `App.jsx`.
- **Shell**: AuthGate, Header, NavigationSidebar, ParticleBackground, (optional) AIAssistant. Mobile: MobileBottomNav when on research-platform or watchlists.
- **Routing**: `currentPage` (sidebar) + `currentView` (`'welcome'` | `'token'`). Hash `#token` = token view.
- **Main content** (first match):
  - `research-zone` → ResearchZoneLite  
  - `structure-guide` → StructureGuidePage  
  - `glossary` → GlossaryPage  
  - `fear-greed` → FearGreedPage  
  - `logs` → LogsPage  
  - `monarch-ai-chat` → AIAssistant (full page)  
  - `social-zone` → SocialZonePage  
  - `ai-media-center` → MediaCenterPage  
  - `x-dash` → XDashPage  
  - `x-bubbles` → XBubblesPage  
  - `search-engine` → inline search  
  - `watchlists` → WatchlistsPage  
  - `currentView === 'welcome'` → WelcomePage  
  - Else → Token view (LeftPanel | TokenBanner + TradingChart + DataTabs | RightPanel).

**Key files**: `App.jsx`, `Header.jsx`, `NavigationSidebar.jsx`, `WelcomePage.jsx`, `ResearchZoneLite.jsx`, `WatchlistsPage.jsx`, `src/hooks/useMediaQuery.js`, `src/services/codexApi.js`. Full map in `docs/APP_STRUCTURE.md`.

---

## 3. What’s next / rest of app to plan

Use this with Claude to prioritize and implement.

### 3.1 Mobile (continue)

- **Watchlists page**: Make WatchlistsPage layout and actions mobile-friendly (touch targets, bottom nav already goes there).
- **Research Zone**: Apply mobile rules (bottom nav or in-page nav, touch targets, compact values) per MOBILE_AGENT_PLAN.
- **Monarch / other full pages**: Same mobile checklist (viewport, touch, header/safe area).
- **Optional**: Command center or Top Coins as bottom sheet on mobile for focus.

### 3.2 Pages still placeholder or to finish

From APP_STRUCTURE, sidebar items that are not fully implemented:

- **ai-media-center** – MediaCenterPage (exists but may be placeholder).
- **x-dash** – XDashPage (placeholder).
- **ai-charts** – placeholder.
- **heatmaps** – placeholder.
- **ai-market-analysis** – placeholder.
- **market-analytics** – placeholder.
- **user-dashboard** – placeholder.

Decide which of these to build next and document in a small plan (route, component, data source, layout).

### 3.3 Research Zone

- **LITE**: Implement or refine per RESEARCH_ZONE_LITE_PLAN (token overview, chart, markets under chart, tabs).
- **PRO**: Define layout and features; keep LITE/PRO toggle in header or page.
- **Mobile**: Fit LITE (and later PRO) into mobile layout and bottom nav or tabs.

### 3.4 Monarch AI

- **@ project UX**: Implement MONARCH_AT_UX_AND_AGENT_PLAN (inline @ tag pill, contentBeforeAt/contentRest, no “Asking about” prefix).
- **Agent reliability**: Friendly fallbacks, no raw errors; optional retries and logging.
- **Mobile**: Monarch chat full page usable on small screens (input, history, touch).

### 3.5 Data & APIs

- **codexApi**: Already has formatPriceShort, formatLargeNumberShort for mobile. Extend as needed for new screens.
- **Other APIs**: binanceApi, coinGeckoApi, polymarketApi, etc. See API_PLAN and SETUP_APIS for keys and usage.
- **State**: Token/watchlist state in App; profile in App + localStorage. Consider shared context or small store if many pages need the same data.

### 3.6 UI/UX consistency

- **Design system**: DESIGN_SYSTEM.md, Spectre glass styling (e.g. welcome widget). Reuse for new components.
- **Day mode**: welcomeDayMode / researchZoneDayMode; apply to new pages and components.
- **Navigation**: Sidebar + mobile bottom nav; any new “main” section should be reachable from both on mobile.

---

## 4. How to use this with Claude (code & structure)

### 4.1 Conventions

- **Mobile**: `useIsMobile()` from `src/hooks/useMediaQuery.js`; breakpoint 768px; touch targets ≥ 44px; bottom nav for primary sections on landing/watchlists.
- **New page**: Add `pageId` in NavigationSidebar, branch in App.jsx main content, create `ComponentName.jsx` + `ComponentName.css` under `src/components/`.
- **Scroll to section**: Use `id` on section (e.g. `#command-center`, `#top-coins`) and `scrollIntoView` or scroll the scroll container (e.g. `.welcome-page`) when needed.
- **Formatting**: Use codexApi formatters (formatCryptoPrice, formatLargeNumber, formatPriceShort, formatLargeNumberShort) for consistency.

### 4.2 Key decisions

- **Welcome scroll container**: `.welcome-page` is the scrollable element for the welcome view; don’t rely on `window.scrollTo` for that content.
- **Bottom nav activeId**: Home when `currentView === 'welcome'`; Command/Top Coins don’t change activeId (both are on same page); Favorites when `currentPage === 'watchlists'`.
- **Plans in docs/**: Prefer updating or adding small plan files (e.g. `docs/MOBILE_WATCHLIST_PLAN.md`) before big changes, then implement.

### 4.3 Suggested next steps (order can change)

1. **Watchlists mobile pass** – Layout and touch; optionally a short `docs/MOBILE_WATCHLIST_PLAN.md`.
2. **Research Zone LITE** – Match RESEARCH_ZONE_LITE_PLAN; wire token from Welcome/Discover.
3. **Monarch @ UX** – Implement MONARCH_AT_UX_AND_AGENT_PLAN (tag pill, send/display model).
4. **Placeholder pages** – Pick one (e.g. user-dashboard or market-analytics), add a one-page plan and implement.
5. **Mobile Research Zone + Monarch** – Apply mobile checklist to those flows.

---

## 5. File reference

| Area | Files / docs |
|------|------------------|
| Routing & shell | `App.jsx`, `App.css` |
| Mobile | `useMediaQuery.js`, `MobileBottomNav.jsx/.css`, `WelcomePage.css` (mobile blocks), `Header.css` (mobile) |
| Structure | `docs/APP_STRUCTURE.md` |
| Mobile rules | `docs/MOBILE_AGENT_PLAN.md`, `docs/MOBILE_LANDING_PLAN.md` |
| Research Zone | `docs/RESEARCH_ZONE_LITE_PLAN.md`, `ResearchZoneLite.jsx` |
| Monarch | `docs/MONARCH_AT_UX_AND_AGENT_PLAN.md`, `MonarchAIChatPage.jsx` / AIAssistant |
| APIs | `docs/API_PLAN.md`, `docs/SETUP_APIS.md`, `src/services/codexApi.js` |

When adding features, update this doc or the relevant plan in `docs/` so the next session (or Claude) has a clear “done vs next” and structure.
