# Spectre Vibe – App Structure

Canonical reference for routes, views, pages, and components. Use this with AI workflow automation (see `PROMPT_APP_STRUCTURE_AUTOMATION.md`).

---

## 1. Entry & shell

| Layer | Description |
|-------|-------------|
| **Entry** | `src/main.jsx` → `App.jsx` |
| **Shell** | `AuthGate` (optional), `Header`, `NavigationSidebar`, `ParticleBackground`, `AIAssistant` (floating) |
| **URL state** | Hash: `#token` = token view; otherwise welcome. `currentPage` in `localStorage` for nav selection. |

---

## 2. Navigation (sidebar)

`currentPage` is set by `NavigationSidebar` → `handlePageChange(pageId)`. Items (from `NavigationSidebar.jsx`):

| pageId | Label | Implemented |
|--------|--------|-------------|
| `research-platform` | Research Platform | Yes → WelcomePage or token view |
| `research-zone` | Research Zone | Yes → ResearchZoneLite |
| `search-engine` | Search Engine | Yes → inline search UI |
| `ai-screener` | AI Screener | Yes → token view (3-column) |
| `watchlists` | Watchlists | Yes → WatchlistsPage |
| `social-zone` | Social Zone | Yes → SocialZonePage |
| `ai-media-center` | AI Media Center | No (placeholder) |
| `x-dash` | X Dash | No (placeholder) |
| `x-bubbles` | X Bubbles | Yes → XBubblesPage |
| `ai-charts` | AI Charts | No (placeholder) |
| `heatmaps` | Heatmaps | No (placeholder) |
| `ai-market-analysis` | AI Market Analysis | No (placeholder) |
| `market-analytics` | Market Analytics | No (placeholder) |
| `user-dashboard` | User Dashboard | No (placeholder) |
| `structure-guide` | Structure Guide | Yes → StructureGuidePage |

---

## 3. Main content routing (App.jsx)

Rendering order (first match wins):

| Condition | Renders |
|-----------|--------|
| `currentPage === 'research-zone'` | `ResearchZoneLite` (full width, no left/right panels) |
| `currentPage === 'structure-guide'` | `StructureGuidePage` |
| `currentPage === 'social-zone'` | `SocialZonePage` |
| `currentPage === 'x-bubbles'` | `XBubblesPage` |
| `currentPage === 'search-engine'` | Inline search-engine JSX (no page component) |
| `currentPage === 'watchlists'` | `WatchlistsPage` |
| `currentView === 'welcome'` | `WelcomePage` (discovery, search, welcome widget) |
| Else (token view) | 3-column layout: `LeftPanel` \| `TokenBanner` + `TradingChart` + `DataTabs` \| `RightPanel` |

**Special:**  
- `research-platform` → `handlePageChange` calls `navigateTo('welcome')`.  
- `ai-screener` → `navigateTo('token')`.  
So “Research Platform” shows WelcomePage (or token if view is token); “AI Screener” shows token 3-column layout.

---

## 4. Views (URL / state)

| View | Hash | Content |
|------|------|--------|
| **welcome** | `#` or none | Discovery: WelcomePage (search, welcome widget, discover grid). |
| **token** | `#token` | Token detail: 3-column layout with LeftPanel, center (TokenBanner, TradingChart, DataTabs), RightPanel. TokenTicker shown above main. |

---

## 5. Subpages / full-page components

Each is a single full-page component (no shared left/right panels unless noted):

| Page | Component | Path | Notes |
|------|-----------|------|--------|
| Research Zone | ResearchZoneLite | `src/components/ResearchZoneLite.jsx` | LITE/PRO toggle, 3-col: left (token overview), center (chart + markets), right (buy, sentiment, news, about). |
| Structure Guide | StructureGuidePage | `src/components/StructureGuidePage.jsx` | App structure guide. |
| Social Zone | SocialZonePage | `src/components/SocialZonePage.jsx` | Social feed / zone. |
| X Bubbles | XBubblesPage | `src/components/XBubblesPage.jsx` | X/bubble visualization. |
| Watchlists | WatchlistsPage | `src/components/WatchlistsPage.jsx` | Multi-watchlist management. |
| Search Engine | (inline) | `App.jsx` | Search UI (no separate component). |
| Welcome (discovery) | WelcomePage | `src/components/WelcomePage.jsx` | Landing-style discovery, welcome widget, search, discover grid. |
| Token (screener) | (layout) | `App.jsx` | LeftPanel + TokenBanner + TradingChart + DataTabs + RightPanel. |

---

## 6. Shared layout (token view only)

When `currentView === 'token'` and `currentPage` is not one of the full-page pages above:

- **Left:** `LeftPanel` (X feed, Watchlist, AI Logs).  
- **Center:** `TokenBanner`, `TradingChart`, `DataTabs`.  
- **Right:** `RightPanel`.  
- **Above main:** `TokenTicker` (only in token view).

---

## 7. Key components (by role)

| Role | Components |
|------|------------|
| Layout/shell | Header, NavigationSidebar, AuthGate, ParticleBackground |
| Token view | LeftPanel, TokenBanner, TokenTicker, TradingChart, DataTabs, RightPanel |
| Full pages | WelcomePage, ResearchZoneLite, StructureGuidePage, SocialZonePage, XBubblesPage, WatchlistsPage |
| Shared UI | spectreIcons (`src/icons/spectreIcons.jsx`), DESIGN_SYSTEM.md, glass styling (Welcome Widget style) |
| Services | codexApi, binanceApi, coinGeckoApi; hooks: useCodexData, useWatchlistPrices |

---

## 8. File map (components)

```
src/
├── App.jsx, App.css          # Router + shell
├── main.jsx, index.css       # Entry + globals
├── components/
│   ├── AuthGate, Header, NavigationSidebar, ParticleBackground, AIAssistant
│   ├── LeftPanel, RightPanel, TokenBanner, TokenTicker, TradingChart, DataTabs
│   ├── WelcomePage, ResearchZoneLite, StructureGuidePage, SocialZonePage, XBubblesPage, WatchlistsPage
│   ├── ChainVolumeBar, SmartMoneyPulse, DesignSystem, CryptoMemoryGame, ResearchPage
│   └── (each has .jsx + .css)
├── hooks/ useCodexData.js, useWatchlistPrices.js
├── services/ codexApi.js, binanceApi.js, coinGeckoApi.js
├── icons/ spectreIcons.jsx
└── constants/ tokenColors.js, majorTokens.js
```

---

*Last updated from App.jsx and NavigationSidebar.jsx. Regenerate or diff when adding/removing pages.*
