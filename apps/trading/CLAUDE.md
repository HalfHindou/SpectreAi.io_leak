# Spectre AI - Trading Terminal (apps/trading)

> Part of the Spectre AI monorepo. See root `CLAUDE.md` for monorepo-wide instructions.
> Shared server: `packages/server/` | Shared UI: `packages/spectre-ui/`

## Overview

Non-custodial crypto trading terminal - real-time market data, interactive charts, multi-chain swap execution. Hash-based routing (no React Router), view-switching via `currentView` state in `App.jsx`.

## Team

- **Gleb** (Co-founder) - primary developer for this app + infra
- **Sunny** (Founder) - research app, sometimes trading features
- **Evgeniy** (Frontend) - features, bug fixes across both apps

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 5 (port 5181), plain CSS |
| Charts | TradingView Lightweight Charts, Three.js/R3F |
| State | Zustand (settings only) |
| Backend | Express.js (dev :3001), Vercel serverless (prod) |
| API | Codex GraphQL, CoinGecko, Binance |
| Icons | lucide-react (^0.563.0) |
| Wallet | Privy (ETH + SOL embedded wallets) |

## Project Structure

```
src/
  App.jsx              Main app - hash router, lazy-loads panels, currentView state
  main.jsx             Entry: PrivyProvider + error boundary + Buffer polyfill
  index.css            CSS custom properties (design tokens, dark/day mode)
  components/          27 component files (flat, not folder-per-page)
    LeftPanel.*        Token list, discovery, search
    RightPanel.*       Swap UI, token details
    Header.*           Top bar, wallet balance, search history
    TradingChart.*     Lightweight Charts + Codex OHLCV
    DataTabs.*         Market data tabs below chart
    TokenBanner.*      Token header with price, change, logo
    TokenTicker.*      Scrolling price ticker
    WelcomePage.*      Landing/discovery page
    AuthGate.*         Team password gate (sessionStorage)
    UserDashboard/     User profile, wallet section (with Privy error boundary)
    ParticleBackground.* Canvas particle effect
    OnboardingPopup.*  First-time user flow
  hooks/               6 files
    useCodexData.js    Master data hook (token search, details, bars, trades)
    useSwapExecution.js  Jupiter (Solana) + 0x (EVM) swap execution
    useWalletBalance.js  Header USD total (polls 30s)
    useWalletBalances.js Per-token balance array for swap UI (polls 15s)
    useProfileSync.js    Profile sync to Vercel KV
    useVisibilityAwareInterval.js  Skip polling when tab hidden
  services/            5 files
    codexApi.js        Codex GraphQL client + Developer Control agent team API (createTeam, spawnAgent, connectTeamStream via EventSource - used by DC only)
    walletService.js   EVM balance reads (Multicall3 batched, fallback to parallel Promise.all if multicall reverts) + Solana SPL.
    analytics.js       PostHog wrapper (APP_NAME = 'trading')
    profileSync.js     /api/user/* profile sync
    swapService.js     Jupiter + 0x quote/execute
  store/
    useSettingsStore.js  Zustand (persists to 'spectre-settings', shared key with research)
  lib/
    privy-config.js    Privy SDK config (v1 loginMethods - intentional, do not upgrade to v2 without testing)
  utils/
    tokenColors.js     200+ token brand colors
    env.js             isDev detection

api/                   9 Vercel serverless functions
  codex.js             Codex GraphQL proxy (token data)
  img-proxy.js         CORS image proxy for external token logos
  user.js              Profile CRUD via Vercel KV (auth required)
  swap.js              Jupiter + 0x swap quotes and execution logs
  fee-config.js        Platform swap fee percentage (public, cached 5min)
  referral.js          Referral code tracking (auth required)
  market-fear-greed.js Fear & Greed index proxy
  tweets-official.js   Official account tweets
  tweets-search.js     Tweet search by keyword
```

## Key Differences from Research App

| Concern | Research | Trading |
|---------|----------|---------|
| Routing | react-router-dom, `@/` alias | Hash-based (`#token`, `#dashboard`), relative imports |
| Icons | `spectreIcons.jsx` (custom SVG) | `lucide-react` |
| Structure | Folder-per-page with `components/` subfolder | Flat `components/` directory |
| State | 3 Zustand stores + 5 contexts | 1 Zustand store, no contexts |
| Privy config | v2 `loginMethodsAndOrder` + Solana connectors | v1 `loginMethods` - intentional, do not upgrade without testing Solana wallet flow |
| walletService | Multicall3 batching (reference implementation) | Multicall3 batching (ported 2026-05-19) |
| AuthGate | Active (team password via sessionStorage, auto-bypassed on localhost) | Active (same pattern, same password) |

## Data Flow

```
Codex GraphQL API
    |
api/codex.js (Vercel serverless) or Express proxy (dev)
    |
src/services/codexApi.js (frontend client, isDev URL switching)
    |
src/hooks/useCodexData.js (React hook, module-level caches)
    |
Components (LeftPanel, TradingChart, DataTabs consume the hook)
```

## View Switching

No React Router. `App.jsx` uses `currentView` state + hash:
```
#discover  -> WelcomePage (default)
#token     -> LeftPanel + TradingChart + RightPanel (3-panel layout)
#dashboard -> UserDashboard (full-screen)
```

Legacy hash URLs redirected in App.jsx useEffect.

## Commands

```bash
npm run dev:trading      # Vite dev server (from monorepo root)
npm run build:trading    # Production build
```

## Coding Standards

See root `.claude/rules/coding-standards.md` for the full reference. Key points:
- NO `@/` alias - use relative imports (`../components/Header`)
- `lucide-react` for icons, NOT `spectreIcons`
- Plain CSS with component-paired files
- No TypeScript (.jsx/.js only)
- Privy hooks: defer to child components, wrap with error boundaries
- `getAccessToken` stored in `useRef` to prevent effect loops
- Buffer polyfill must be first import in `main.jsx`
