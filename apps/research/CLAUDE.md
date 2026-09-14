# Spectre AI - Research Platform (apps/research)

> Part of the Spectre AI monorepo. See root `CLAUDE.md` for monorepo-wide instructions.
> Shared server: `packages/server/` | Shared UI: `packages/spectre-ui/` | Extension: `packages/chrome-extension/`

## Overview

Crypto intelligence dashboard - ~68 page folders, dark-first glassmorphic design. The primary Spectre app for market research, news, analytics, and portfolio tracking.

> **Map:** full page-by-page index, layout tiers, state map, service/hook navigation, and footguns live in `.claude/rules/research-platform.md` (auto-loads on any apps/research file). Start there to navigate.

## Team

- **Sunny** (Founder) - primary developer for this app
- **Gleb** (Co-founder) - infra, trading app, shared packages
- **Evgeniy** (Frontend) - features, bug fixes across both apps

## Tech Stack

- React 18 + Vite 5 (port 5180, `@` alias -> `src/`)
- Plain CSS with component-paired stylesheets (NO Tailwind, NO Next.js)
- CSS custom properties for all design tokens (see `.claude/rules/design-system.md`)
- Zustand v5 for persistent state, React Context for transient state
- react-router-dom v7, i18next (20 languages - English eager, the rest code-split), Framer Motion
- JavaScript only (.jsx/.js) - no TypeScript in app code

## Project Structure

```
src/
  App.jsx              Providers + React Router routes (~610 lines)
  main.jsx             Entry: BrowserRouter + PrivyBoundary (lazy-mounts Privy
                       AFTER first paint - see lib/privy-boundary.jsx) + error boundary
  store/
    useSettingsStore.js     Zustand (persists to 'spectre-settings' localStorage)
    useNotificationStore.js Zustand (persists to 'spectre-notifications')
    useMediaStore.js        Zustand (persists to 'spectre-media')
    migrateOldSettings.js   Runs once on app load before React mounts. Safe to ignore unless changing localStorage keys.
  contexts/
    AppStateContext.jsx     Token selection, panel collapse, mobile tab
    WatchlistsContext.jsx   Dual crypto/stock watchlists, CRUD
    I18nCurrencyContext.jsx Exchange rates, fmtPrice/fmtLarge formatters
    MonarchContext.jsx      AI chat messages, streaming state
    CopyToastContext.jsx    Copy-to-clipboard toast
    MobilePreviewContext.js Mobile preview frame flag
  pages/                    ~68 folders, kebab-case (full map: .claude/rules/research-platform.md)
    {name}/index.jsx        Thin wrapper: reads stores/contexts, passes props
    {name}/components/      Actual UI, CSS files, page-specific hooks/constants
  components/               Shared only (used by 2+ pages)
    layouts/                AppShell, PageShell, PageLayout
    header.jsx              Top bar with search, profile, toggles
    navigation-sidebar.jsx  Left nav (+ mobile-header.jsx, mobile-bottom-nav.jsx)
    trading-chart.jsx       Shared chart component
  services/                 ~31 files: codexApi, coinGeckoApi, binanceApi, etc.
  hooks/                    ~59 files: useCodexData, useWalletBalances, etc.
  constants/                majorTokens, pageRoutes, tokenColors, stockData
  lib/                      formatCurrency, privy-config, tooltip-system, etc.
  icons/                    spectreIcons.jsx (50+ SVG icons)
  i18n/                     20 locale JSON files (+ en-rest.json) + init config
  styles/                   mobile-2026.css (current mobile token file - name is intentional, not outdated)

api/                        ~36 serverless routers + ~63 _lib/handlers/
  codex.js, cg-proxy.js, binance-ticker.js, fear-greed.js, news.js,
  user.js, swap.js, calendar-api.js, intelligence-api.js, stocks.js, etc.
```

## Routing

- `BrowserRouter` in `main.jsx`
- Provider stack: I18nCurrency -> CopyToast -> AppState -> Monarch -> Watchlists -> AuthGate
- All pages lazy-loaded with `React.lazy`, `Suspense fallback={null}`
- Navigate by page ID: `getPathForPageId('ai-screener')` from `constants/pageRoutes.js`
- Standalone pages (outside AppShell): `/newsroom`, `/website`
- `PageErrorBoundary` wraps every route

### Token Page Architecture (`/token`)

The token page is NOT a normal page - it embeds the trading app via iframe for the chart + swap UI. Research owns the left panel (token list) and the page wrapper. The trading app renders inside the iframe at `localhost:5181/#token` (dev) or `trade.spectreai.io/#token` (prod). Do not duplicate chart or swap components in research - they live in the trading app.

**Domain layout (post-2026-05-19 DNS swap):**
- `app.spectreai.io` -> research (this app). Custom-domain alias of `spectre-app-research.vercel.app`.
- `trade.spectreai.io` -> trading. Custom-domain alias of `spectre-trading.vercel.app`.
- Both apps live under `.spectreai.io` parent. Improves Privy session sharing across the iframe (Chrome/Firefox work fully; Safari ITP still blocks nested-iframe storage so Safari users may see a one-time wallet re-connect inside the embed).
- The legacy v1 product (Spectre AI Search Engine) previously occupied `app.spectreai.io` and was sunset/redirected during the swap.


## Key Patterns

- **Page structure**: `index.jsx` (state wrapper) + `components/` subfolder (UI + CSS)
- **CSS splits**: `.css`, `.day-mode.css`, `.mobile.css`, `.cinema-mode.css` per component
- **Import alias**: `@/` for all cross-directory imports (`@/components/Header`), relative for siblings
- **Icons**: `spectreIcons` from `src/icons/` - never import icon libraries in components
- **Formatting**: use `useCurrency()` context for prices, never call `formatPrice()` directly
- **Analytics**: `import { track, Events } from '@/services/analytics'` - never import posthog directly
- **Auth**: `AuthGate` (team password via sessionStorage), Privy (wallet/identity, optional)

## Commands

```bash
npm run dev:research     # Vite dev server (from monorepo root)
npm run build:research   # Production build
npm run dev:safe         # With --max-old-space-size=4096 (OOM protection)
```

## Coding Standards

See root `.claude/rules/coding-standards.md` for the full reference. Key points:
- Functional components with hooks, no class components (exception: error boundaries)
- Plain CSS with component-paired files, CSS custom properties for all tokens
- Default exports for components, named exports for utilities
- All hooks return objects (not arrays)
- `useCallback`/`useMemo` only when measured perf issue or stable-ref requirement
- No spinners - shimmer skeletons only
- Numbers/prices always in `var(--font-mono)` (exception: website2 uses `Geist` sans-serif for everything - NO monospace)
