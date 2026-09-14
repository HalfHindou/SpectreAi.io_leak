# SPECTRE AI — Technical Documentation

**Version:** 1.0
**Date:** February 10, 2026
**Status:** Research Platform — Active Development
**Reference:** `Spectre_AI_Business_Requirements.md`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Product Scope — Three Products](#3-product-scope--three-products)
4. [Feature Inventory — Research Platform](#4-feature-inventory--research-platform)
5. [Feature Inventory — Trading Platform (Lite)](#5-feature-inventory--trading-platform-lite)
6. [Feature Inventory — Trading Platform (Pro)](#6-feature-inventory--trading-platform-pro)
7. [Shared Infrastructure Requirements](#7-shared-infrastructure-requirements)
8. [Page-by-Page Implementation Status](#8-page-by-page-implementation-status)
9. [API Layer & Data Infrastructure](#9-api-layer--data-infrastructure)
10. [State Management & Persistence](#10-state-management--persistence)
11. [Display Modes & Theming](#11-display-modes--theming)
12. [Mobile Platform](#12-mobile-platform)
13. [AI Agent System](#13-ai-agent-system)
14. [Gap Analysis — Missing Features & Technical Solutions](#14-gap-analysis--missing-features--technical-solutions)
15. [Technical Debt](#15-technical-debt)
16. [Recommended Roadmap](#16-recommended-roadmap)
17. [File Reference](#17-file-reference)

---

## 1. Executive Summary

### What Spectre AI Is

Spectre AI is a **three-product crypto intelligence ecosystem**:

1. **Research Platform** (`app.spectreai.io`) — An all-in-one crypto and stock research dashboard. Discovery, market analysis, AI agent, watchlists, real-time charts, news, sentiment, on-chain data. Two visual modes: Terminal (data-dense) and Cinema (Netflix-style immersive).

2. **Trading Platform Lite** (`trade.spectreai.io/lite`) — An Apple-grade DeFi trading interface for investors and newcomers. Simple swap, limit orders, research context alongside trading. Also embedded inside the Research Platform as the token detail view.

3. **Trading Platform Pro** (`trade.spectreai.io/pro`) — A high-speed DeFi trading terminal for memecoin/active traders. Competes with GmGn, Axiom, Photon, Padre. Advanced swap, sniper tools, copy trading, social intelligence.

### What Is Built Today

The **Research Platform frontend** is substantially built as a React + Vite single-page application. It runs at `localhost:5180` with a Node/Express proxy server at `localhost:3001`. The app includes:

- **21 navigable pages** covering discovery, research, market analysis, watchlists, social, education, and AI
- **Dual display modes**: Terminal (standard data layout) and Cinema (Netflix-style immersive with animated backgrounds)
- **Day/Night theming** across most pages
- **Full mobile responsive design** with dedicated mobile components (bottom nav, swipeable rows, optimized layouts)
- **Real-time data** from Codex API (primary), CoinGecko, and Binance with intelligent fallback chains
- **Interactive charting** with 6 timeframes, 3 chart types, auto-refresh
- **Multi-watchlist management** with real-time prices
- **Spectre AI Agent** (currently labeled "Monarch AI") with chat interface, egg progression system, and agent personality
- **Stock market mode** (basic integration alongside crypto)

### What Is NOT Built Yet

- **Trading execution** — No swap widget, no wallet integration, no on-chain execution. The entire Trading Lite and Trading Pro products are not built.
- **Authentication** — Currently uses a team password gate, not real auth (wallet, Google, email, Discord, Telegram).
- **Backend infrastructure** — The server is a proxy/cache layer only. No database, no user accounts, no persistent user data beyond localStorage.
- **Info tooltips** — The universal education layer (tooltips on every metric) is not implemented.
- **Real social data** — X/Twitter feed shows mock data. No live social API integration.
- **Custodial wallet system** — The platform-generated wallet model (like GmGn) does not exist.

---

## 2. Architecture Overview

### Current Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | React 18.2 + Vite 5.0 | Single-page app, no SSR |
| **Styling** | Vanilla CSS (no Tailwind) | ~15 CSS files, glassmorphic design system |
| **State** | React useState/useContext | No Redux/Zustand. Global state in App.jsx |
| **Persistence** | localStorage | Watchlists, preferences, profile, egg state |
| **Backend** | Node.js + Express | Proxy server on port 3001, caching layer |
| **Charts** | Canvas-based custom | TradingChart.jsx — candlestick/line/heatmap |
| **Animations** | Framer Motion 12.33 | Page transitions, card effects |
| **Video** | Remotion 4.0 | Imported but not actively used |
| **Voice** | ElevenLabs SDK 1.59 | Imported but not actively used |

### Data Flow

```
User Action (navigate, search, select token)
    ↓
App.jsx state update → Component renders
    ↓
Custom hooks fire (useCodexData, useChartData, useWatchlistPrices)
    ↓
API call: Frontend → Express proxy (port 3001) → External API
    ↓
Fallback chain: Codex API → CoinGecko → Binance → Mock data
    ↓
Cache layer (30s prices, 15s details, 2min trending)
    ↓
Component re-renders with live data
    ↓
Auto-refresh intervals (10-30s depending on data type)
```

### Deployment

- **Frontend**: Vite build → static bundle → Vercel
- **Backend**: Express server → Vercel serverless functions or standalone Node
- **Environment**: API keys stored in `server/.env`, never exposed to frontend

### Codebase Size

| Category | Files | Lines of Code (approx) |
|----------|-------|----------------------|
| Components (JSX) | 52 | ~18,000 |
| Cinema components | 7 | ~3,500 |
| Egg/Agent system | 9 | ~2,500 |
| CSS files | 25+ | ~20,000 |
| Hooks | 5 | ~2,000 |
| Services (API) | 8 | ~3,000 |
| Server | 1 (+ routes) | ~3,300 |
| **Total** | **~107** | **~52,000** |

---

## 3. Product Scope — Three Products

Per the Business Requirements Document, Spectre AI consists of three products that share auth, wallet, data, and the AI Agent:

| Product | URL | Status | Description |
|---------|-----|--------|-------------|
| **Research Platform** | `app.spectreai.io` | **In Development** — Frontend ~70% built, backend proxy only | Discovery, research, analysis, AI agent, watchlists |
| **Trading Platform (Lite)** | `trade.spectreai.io/lite` | **Not Started** | Clean swap UI, limit orders, research context |
| **Trading Platform (Pro)** | `trade.spectreai.io/pro` | **Not Started** | Advanced terminal competing with GmGn/Axiom/Photon |

**Shared infrastructure needed** (not yet built):
- Unified authentication (wallet, Google, email, Discord, Telegram)
- Custodial wallet system (platform-generated wallets, deposit/withdraw)
- On-chain swap execution layer
- Shared user database (accounts, watchlists, preferences)
- Shared data layer (prices, sentiment, on-chain, social)

---

## 4. Feature Inventory — Research Platform

Status key: `DONE` = Fully implemented | `PARTIAL` = Core exists, needs work | `STUB` = Page/component exists but minimal | `NOT STARTED` = Not built

### Home / Discovery (Landing View)

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Welcome widget with market snapshot | `DONE` | Top coins grid with prices, 24h change, sparklines. Crypto indices, market hours. |
| Search by token name, symbol, or contract address | `DONE` | Codex API search with CoinGecko fallback. Real-time results. |
| Discover grid: trending tokens, top gainers | `DONE` | On-chain discovery per chain (Solana, ETH, BSC, etc.), trending row, top gainers. |
| Category filters (Meme, DEX, AI & DePIN, Layer 1, etc.) | `DONE` | Categories page + filter pills on discovery. |
| Filter by chain | `DONE` | Chain selector: Ethereum, Solana, BSC, Arbitrum, Base, Polygon, Optimism, Avalanche. |
| Crypto/Stocks mode switch | `DONE` | Header toggle. Stocks mode uses Alpha Vantage data. |
| Click token → detail view or add to watchlist | `DONE` | Click navigates to Research Zone or token view. Add to watchlist via star icon. |
| Product tour for new users | `NOT STARTED` | No onboarding tour, no first-run guidance. |
| Info tooltips on all data points | `NOT STARTED` | No tooltip system exists. |

### Token Detail View / Trading Platform (Lite) View

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Three-column layout | `DONE` | Left (watchlist + AI logs), Center (banner + chart + tabs), Right (stats + news + about). |
| Token banner (price, 24h change, market cap, volume) | `DONE` | TokenBanner component with real-time data. |
| Trading chart (candlestick/line, multiple timeframes) | `DONE` | TradingChart: 6 timeframes (5M→1W), 3 chart types, zoom/pan, ATH markers, auto-refresh. |
| Data tabs under chart | `PARTIAL` | DataTabs component exists. Transaction history shows mock data. Real-time trades partially implemented via Codex. |
| Left panel: X/Twitter social feed | `STUB` | Mock tweet data displayed. No live X API integration. |
| Left panel: Watchlist with live prices | `DONE` | Real-time watchlist prices via Binance (30s refresh). |
| Left panel: AI Logs (agent signals) | `PARTIAL` | Orchestrator/Backend/Security agent signals displayed. Currently mock/generated data. |
| Right panel: Market stats | `DONE` | Supply, market cap, FDV, volume, holder data. |
| Right panel: Full Lite trading (buy/sell, limit orders) | `NOT STARTED` | No swap widget, no trading functionality. Right panel shows stats only. |
| Right panel: Sentiment score | `PARTIAL` | Sentiment gauge component exists but uses calculated/mock data. |
| Right panel: News feed | `DONE` | CryptoPanic + RSS aggregation. Real API data. |
| Right panel: About section | `DONE` | Token description, links, social profiles. |
| Right panel: Buttons to open standalone Lite or Pro | `NOT STARTED` | No links to trading platforms (they don't exist yet). |
| Holders tab (distribution, top holders) | `PARTIAL` | Holder data displayed when available from Codex. Not all tokens have holder data. |
| On-Chain Bubblemap tab | `NOT STARTED` | No bubblemap visualization. |
| X Bubblemap tab | `STUB` | XBubblesPage exists as separate page, not as tab within token view. |
| Token ticker strip | `DONE` | TokenTicker component above main content. |
| Multi-chain support | `DONE` | Ethereum, Solana, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche via Codex. |
| Real-time price, volume, liquidity | `PARTIAL` | Price and volume are real-time. Liquidity data available for some tokens via Codex. |

### Research Zone

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Full-page deep research layout | `DONE` | ResearchZoneLite.jsx — 3-column layout, token hero section, chart, tabs. |
| Agent RSS / AI signals | `PARTIAL` | Signal cards displayed (Orchestrator, Backend, Blockchain, Security). Mock data. |
| Curated X feed with real tweets | `STUB` | Mock tweets displayed. No live X API. |
| Prediction markets (Polymarket) | `PARTIAL` | Polymarket widget exists. Uses mock data — no real Polymarket API integration. |
| News section (Crypto Panic, RSS) | `DONE` | Real CryptoPanic + RSS feed aggregation. |
| LITE/PRO toggle | `NOT STARTED` | No toggle between research depth levels. |
| Day mode support | `DONE` | Full day mode CSS with light palette. |

### Spectre AI Agent (Currently "Monarch AI Chat")

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Dedicated AI chat page | `DONE` | SpectreAgentChat component. Chat interface with message history. |
| Plain language questions | `PARTIAL` | Chat accepts input. Responses are generated locally (agentResponses.js), NOT via LLM API. |
| Can request charts, news, navigation | `PARTIAL` | @ mention for tokens works. Navigation triggering is basic. |
| Floating AI assistant on all pages | `DONE` | AgentFAB (Floating Action Button) appears after egg hatches. Available on all pages. |
| Uses all platform data when answering | `NOT STARTED` | Agent does not have access to live platform data. Uses pre-written response templates. |
| Can browse the web and research projects | `NOT STARTED` | No web browsing capability. |
| On-chain trade execution (future) | `NOT STARTED` | Planned for later phase per business requirements. |
| Agent suggests but never decides | `DONE` | Agent responses are informational, never auto-execute. |
| Agent renamed from Monarch to Spectre AI Agent | `NOT STARTED` | UI still shows "Monarch AI Chat" in several places. |

### Market Analysis Tools

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Fear & Greed Index (live value, historical, factors) | `DONE` | FearGreedPage with live API, historical chart, contributing factors breakdown. |
| Smart Money Pulse dashboard | `DONE` | MarketAnalyticsPage with institutional vs retail flow visualization. |
| AI Market Analysis (daily AI overview) | `PARTIAL` | AIMarketAnalysisPage exists. Sentiment display present. AI-generated daily briefs not connected to LLM. |
| ROI to ATH Calculator | `DONE` | ROICalculatorPage — enter amount, select token, see ROI if returns to ATH. |
| GM Dashboard | `DONE` | Full-screen zen dashboard: greeting, clock, top 5 crypto, top 5 stocks, news, weather (Open-Meteo API). |
| AI Charts | `PARTIAL` | AIChartsPage exists. Chart with AI analysis overlay — basic implementation. |
| AI Charts Lab | `STUB` | AIChartsLabPage exists as experimental page. Minimal content. |
| Heatmaps | `DONE` | HeatmapsPage with market heatmap grid visualization. Error handling + retry. |
| Bubbles | `DONE` | BubblesPage with bubble-style market visualization. Error handling + retry. |

### Discovery and Screening

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Discover page (curated editorial) | `DONE` | DiscoverPage with breathing chart backgrounds, editorial typography, token stories. |
| Categories page | `DONE` | CategoriesPage — browse by category (Meme, DEX, Layer 1, AI & DePIN, etc.). |
| Token Storybook (Cinema Mode stories) | `DONE` | TokenStorybook — immersive full-screen token biography with chapters. |
| X Bubbles (social visualization) | `DONE` | XBubblesPage — bubble visualization of X/social activity. |
| X Dash (Twitter dashboard) | `PARTIAL` | XDashPage exists. Social intelligence display. Limited without live X API. |

### Watchlists

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Create, rename, delete watchlists | `DONE` | Full multi-watchlist CRUD. |
| Add/remove tokens, reorder | `DONE` | Drag reorder, swipeable delete on mobile. |
| Live prices, real-time updates | `DONE` | Binance API, 30s refresh via useWatchlistPrices hook. |
| Search to add tokens | `DONE` | Codex search integration within watchlist manager. |
| Accessible from sidebar and left panel | `DONE` | Sidebar watchlist page + left panel in token view. |
| Price/sentiment/whale alerts | `NOT STARTED` | No alert system exists. No notifications. |

### Social Zone

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Community social feed | `STUB` | SocialZonePage exists. Basic layout. No live social data. |
| Social-driven insights | `NOT STARTED` | No social sentiment analysis pipeline. |
| X/Twitter integration | `STUB` | Mock data. TWITTER_BEARER_TOKEN env var exists but no live integration. |

### Education Layer

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Info tooltips on every metric | `NOT STARTED` | No tooltip system. This is flagged as critical in business requirements ("visible by default on first visit"). |
| Glossary page | `DONE` | GlossaryPage with DeFi/crypto terminology definitions. |
| Structure Guide | `DONE` | StructureGuidePage — in-app explanation of routes and layout. |
| AI Agent adapts to experience level | `NOT STARTED` | No user experience level detection or adaptive responses. |

### Cinema Mode

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Full-screen immersive experience | `DONE` | CinemaWelcomeWrapper with animated canvas background, glassmorphic cards. |
| Standard/Cinematic toggle in header | `DONE` | Header toggle switches appDisplayMode between 'terminal' and 'cinema'. |
| Token stories with chapters | `DONE` | TokenStorybook — full-screen, chapter-based narrative with scroll navigation, ESC to exit. |
| Hero section (token name, tagline, price, stats) | `DONE` | Cinema hero with Playfair Display typography, price widget, 24h change. |
| Netflix-style horizontal rows | `DONE` | CinemaDiscovery — trending, top gainers, category rows with horizontal scroll. |
| Day mode for cinema | `DONE` | `.cinema-welcome.day-mode` selector with full light palette. |
| Expand cinema beyond welcome page | `NOT STARTED` | Cinema mode currently only on Welcome/Discovery page. Not on Research Zone or other pages. |

### Interface and Modes

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Dark mode (default) | `DONE` | Glassmorphic dark theme, `#0a0a0f` base. |
| Light/day mode (global toggle) | `DONE` | Global toggle, persists to localStorage. Covers most pages. |
| Collapsible sidebar with tooltips | `DONE` | NavigationSidebar — icon-only (56px) when collapsed, full (240px) when expanded. Hover tooltips. |
| Mobile fully responsive with bottom nav | `DONE` | MobileBottomNav (5 tabs), MobileHeader, responsive CSS across all pages. |
| Copy actions show toast | `DONE` | CopyToastContext — brief toast on contract address copy. |

### Authentication

| Business Requirement | Status | Implementation Notes |
|---------------------|--------|---------------------|
| Wallet connection | `NOT STARTED` | No wallet adapter (Phantom, MetaMask, etc.). |
| Google account login | `NOT STARTED` | No OAuth integration. |
| Email login | `NOT STARTED` | No email auth. |
| Discord login | `NOT STARTED` | No Discord OAuth. |
| Telegram login | `NOT STARTED` | No Telegram auth widget. |
| Shared auth across all 3 products | `NOT STARTED` | No auth system at all. Currently using team password gate (AuthGate.jsx). |

### Business Rules

| Rule | Status | Notes |
|------|--------|-------|
| Free basic, premium for advanced | `NOT STARTED` | No subscription, no $SPECTRE token gating. |
| AI disclaimer (not financial advice) | `NOT STARTED` | No disclaimers shown. |
| Real-time or near-real-time data | `DONE` | 30s price refresh, 15s chart refresh. |
| Mobile is must-have | `DONE` | Full responsive design with dedicated mobile components. |
| Personal data private and secure | `PARTIAL` | localStorage only — no cloud sync, no encryption. Adequate for current stage. |
| Data sources clearly attributed | `NOT STARTED` | No source attribution on data points. |
| Research → Trading seamless transition | `NOT STARTED` | No trading platforms to transition to. |
| AI Agent never executes without approval | `DONE` | Agent is informational only, no execution capability. |
| Info tooltips visible by default on first visit | `NOT STARTED` | No tooltip system. |

---

## 5. Feature Inventory — Trading Platform (Lite)

**Overall Status: `NOT STARTED`**

The Trading Platform (Lite) is an entirely separate product that does not yet exist. It requires both frontend and backend infrastructure.

| Feature Area | Business Requirement | Status | Technical Solution (Proposed) |
|-------------|---------------------|--------|------------------------------|
| **Discover/Welcome** | Own landing page at trade.spectreai.io/lite | `NOT STARTED` | Separate Vite app or route-based code split within monorepo |
| **Wallet System** | Platform-generated custodial wallet | `NOT STARTED` | Backend wallet service (HD wallet generation, key management, deposit/withdraw) |
| **Swap Widget** | Simple token swap UI | `NOT STARTED` | React component wrapping on-chain execution SDK (Jupiter for Solana, 1inch/0x for EVM) |
| **Limit Orders** | Set target price, auto-execute | `NOT STARTED` | Backend order book service + on-chain settlement |
| **Fund Management** | Deposit/withdraw crypto | `NOT STARTED` | Wallet service with transaction signing |
| **Multi-chain** | 10+ blockchain networks | `NOT STARTED` | Chain abstraction layer per network (Solana, ETH, BSC, Polygon, Arbitrum, Base, etc.) |
| **Research Context** | Sentiment, AI risk, social alongside trade | `PARTIAL` | Research Platform already has these components — embed into Lite view |
| **Safety** | Honeypot detection, liquidity check, contract verification | `NOT STARTED` | GoPlus or similar security API + custom heuristics |
| **Onboarding** | Guided first-trade experience | `NOT STARTED` | Step-by-step wizard component + tooltips |
| **Fee System** | 1% per swap, transparent display | `NOT STARTED` | Fee calculation in swap execution layer |
| **Pro Link** | Button to open Pro in new tab | `NOT STARTED` | Simple navigation link (requires Pro to exist) |

---

## 6. Feature Inventory — Trading Platform (Pro)

**Overall Status: `NOT STARTED`**

The Trading Platform (Pro) is an entirely separate product competing with GmGn, Axiom, Photon. It shares the execution layer with Lite but has a completely different interface.

| Feature Area | Business Requirement | Status | Technical Solution (Proposed) |
|-------------|---------------------|--------|------------------------------|
| **Discover/Welcome** | Own landing page: new launches, trending, smart money | `NOT STARTED` | Pro-specific discover page with data-dense layout |
| **Advanced Swap** | Fees/tips config, slippage settings, routing | `NOT STARTED` | Extended swap widget with advanced controls |
| **Sniper Tools** | One-click buy on new launches | `NOT STARTED` | Real-time token launch detection + instant execution |
| **Take-Profit/Stop-Loss** | On-chain conditional orders | `NOT STARTED` | Backend order management + on-chain execution |
| **Copy Trading** | Follow wallets, copy trades | `NOT STARTED` | Wallet tracking service + execution mirroring |
| **Smart Money Tracking** | Wallet-to-social mapping, intent signals | `NOT STARTED` | On-chain wallet analysis + X API correlation |
| **Social Intelligence** | Real-time X feed, sentiment, KOL tracking | `STUB` | Components exist in Research Platform but need live X API |
| **AI Risk Score** | Green/yellow/red per token | `NOT STARTED` | Multi-signal aggregation (contract, holders, LP, social) |
| **Advanced Filtering** | On-chain metrics, social, holder, liquidity, safety | `NOT STARTED` | Filter engine component + backend query layer |
| **Speed Parity** | Match GmGn/Axiom execution speed | `NOT STARTED` | Optimized RPC endpoints, priority fees, pre-signed transactions |

---

## 7. Shared Infrastructure Requirements

These systems must be built once and shared across all three products:

| System | Status | Description | Priority |
|--------|--------|-------------|----------|
| **Authentication** | `NOT STARTED` | Wallet (Phantom, MetaMask), Google OAuth, Email, Discord, Telegram. Single sign-on across all 3 products. | **P0** |
| **User Database** | `NOT STARTED` | User accounts, preferences, watchlists (currently localStorage). PostgreSQL or similar. | **P0** |
| **Custodial Wallet Service** | `NOT STARTED` | Platform-generated HD wallets per user. Deposit, withdraw, balance tracking. Key management (HSM or KMS). | **P0** |
| **On-Chain Execution Layer** | `NOT STARTED` | Swap execution across 10+ chains. Jupiter (Solana), 1inch/0x (EVM), with routing optimization. | **P0** |
| **Fee & Revenue System** | `NOT STARTED` | 1% swap fee, fee transparency, revenue tracking. | **P1** |
| **Notification/Alert Service** | `NOT STARTED` | Price alerts, sentiment alerts, whale activity. Push + in-app + email. | **P1** |
| **Real Social Data Pipeline** | `NOT STARTED` | Live X/Twitter API, sentiment analysis, KOL tracking, social volume detection. | **P1** |
| **Info Tooltip System** | `NOT STARTED` | Universal tooltip component with content database. Visible by default, hide in settings. | **P1** |
| **AI Agent Backend (LLM)** | `NOT STARTED` | Connect agent to OpenAI/Anthropic API with platform data context. Web browsing, project research. | **P1** |
| **Safety/Security APIs** | `NOT STARTED` | Honeypot detection, contract verification, LP analysis. GoPlus or Token Sniffer integration. | **P1** |
| **Subscription/Token Gating** | `NOT STARTED` | Free tier vs premium. $SPECTRE token holding check. | **P2** |
| **Analytics & Telemetry** | `NOT STARTED` | User behavior tracking, funnel analytics, performance monitoring. | **P2** |

---

## 8. Page-by-Page Implementation Status

### Research Platform — All Pages

| # | Page ID | Component | Status | Day Mode | Mobile | Cinema Mode | Notes |
|---|---------|-----------|--------|----------|--------|-------------|-------|
| 1 | `research-platform` | WelcomePage | `DONE` | Yes | Yes | Yes | 6,844 lines. Landing hub with token discovery, market overview. |
| 2 | `research-zone` | ResearchZoneLite | `DONE` | Yes | Yes | No | Token research page. 3-column layout, chart, news, stats. |
| 3 | `discover` | DiscoverPage | `DONE` | Yes | Yes | Yes | Editorial token discovery with breathing charts. |
| 4 | `watchlists` | WatchlistsPage | `DONE` | Yes | Yes | No | Multi-watchlist manager. CRUD, reorder, live prices. |
| 5 | `ai-screener` | (via token view) | `PARTIAL` | Yes | Yes | No | Token detail + AI logs. Currently named "AI Screener" in nav — per business reqs this becomes the Lite trading view. |
| 6 | `categories` | CategoriesPage | `DONE` | Yes | Yes | No | Browse tokens by category. |
| 7 | `fear-greed` | FearGreedPage | `DONE` | Yes | Yes | No | Live Fear & Greed Index with historical chart. |
| 8 | `market-analytics` | MarketAnalyticsPage | `DONE` | Yes | Partial | No | Smart Money Pulse dashboard. |
| 9 | `ai-market-analysis` | AIMarketAnalysisPage | `PARTIAL` | Yes | Partial | No | AI sentiment analysis. Needs LLM connection. |
| 10 | `heatmaps` | HeatmapsPage | `DONE` | Partial | Partial | No | Market heatmap grid. |
| 11 | `bubbles` | BubblesPage | `DONE` | Partial | Partial | No | Bubble chart market view. |
| 12 | `ai-charts` | AIChartsPage | `PARTIAL` | No | Partial | No | AI chart analysis. Basic implementation. |
| 13 | `ai-charts-lab` | AIChartsLabPage | `STUB` | No | No | No | Experimental chart tools. Minimal content. |
| 14 | `x-dash` | XDashPage | `STUB` | No | No | No | X/Twitter dashboard. Needs live X API. |
| 15 | `x-bubbles` | XBubblesPage | `DONE` | No | Partial | No | X social bubble visualization. |
| 16 | `social-zone` | SocialZonePage | `STUB` | No | No | No | Social feed. Needs live social API. |
| 17 | `ai-media-center` | MediaCenterPage | `STUB` | No | No | No | Media/news aggregation. Basic layout only. |
| 18 | `roi-calculator` | ROICalculatorPage | `DONE` | Yes | Yes | No | Fully functional ROI calculator. |
| 19 | `glossary` | GlossaryPage | `DONE` | Yes | Yes | No | Crypto/DeFi terminology reference. |
| 20 | `structure-guide` | StructureGuidePage | `DONE` | No | Partial | No | In-app structure guide. |
| 21 | `logs` | LogsPage | `PARTIAL` | No | No | No | AI agent logs viewer. |
| 22 | `search-engine` | (inline) | `DONE` | No | Yes | No | Unified search interface. |
| — | GM Dashboard | GMDashboard | `DONE` | No | No | No | Full-screen overlay. Clock, weather, prices, news. |
| — | Token Storybook | TokenStorybook | `DONE` | Yes | Partial | Yes | Full-screen token biography with chapters. |

### Summary

- **Fully Implemented:** 13 pages
- **Partially Implemented:** 5 pages
- **Stub/Minimal:** 4 pages
- **Not Started:** Trading Lite, Trading Pro (entire products)

---

## 9. API Layer & Data Infrastructure

### External APIs

| API | Purpose | Integration Status | Env Variable | Notes |
|-----|---------|-------------------|--------------|-------|
| **Codex API** | Token search, trending, prices, chart bars, token details, trades | `DONE` — Primary data source | `CODEX_API_KEY` | GraphQL API. Most comprehensive data. Required. |
| **Binance API** | Real-time prices, kline/OHLCV data | `DONE` — Secondary/fallback | None (public) | Used for price refresh (30s) and chart fallback. |
| **CoinGecko API** | Major token details, market data, search fallback | `DONE` — Tertiary fallback | `COINGECKO_API_KEY` (optional) | Free tier rate limited. 2min cache. |
| **CryptoPanic API** | Crypto news aggregation | `DONE` | Via server proxy | Real news data. |
| **Open-Meteo API** | Weather data (GM Dashboard) | `DONE` | None (public) | No API key needed. |
| **Alpha Vantage** | Stock market data | `PARTIAL` | Configured in stockApi.js | Basic stock prices. Limited by free tier. |
| **NewsAPI** | General news | `PARTIAL` | `NEWS_API_KEY` | Stock news integration. |
| **Polymarket** | Prediction markets | `STUB` | None | Mock data only. No real API integration. |
| **X/Twitter API** | Social feed, sentiment | `NOT STARTED` | `TWITTER_BEARER_TOKEN` | Env var exists but no live integration. Mock tweets only. |
| **OpenAI API** | AI agent responses | `NOT STARTED` | `OPENAI_API_KEY` | Key configured but agent uses local response templates. |
| **Anthropic API** | AI agent responses (Claude) | `NOT STARTED` | `ANTHROPIC_API_KEY` | Key configured but not connected. |
| **ElevenLabs** | AI voice briefs | `NOT STARTED` | `ELEVENLABS_API_KEY` | SDK imported, not integrated. |
| **GoPlus / Token Sniffer** | Contract security analysis | `NOT STARTED` | — | Needed for safety checks (honeypot, rug detection). |

### Backend Server Endpoints

**Server:** `server/index.js` (3,289 lines) on port 3001

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/health` | GET | Health check | `DONE` |
| `/api/tokens/search?q=` | GET | Token search (Codex → CoinGecko fallback) | `DONE` |
| `/api/tokens/trending` | GET | Trending tokens | `DONE` |
| `/api/token/details?address=&networkId=` | GET | Token details | `DONE` |
| `/api/tokens/price/:symbol` | GET | Single token price | `DONE` |
| `/api/tokens/prices?symbols=` | GET | Batch prices | `DONE` |
| `/api/bars?symbol=&from=&to=&resolution=` | GET | OHLCV chart bars | `DONE` |
| `/api/token/trades?address=&networkId=&limit=` | GET | Latest trades | `DONE` |
| `/api/env-check` | GET | Check configured API keys | `DONE` |
| `/api/v1/posting/*` | POST | Content posting API | `PARTIAL` |

### Endpoints Needed (Not Built)

| Endpoint | Purpose | Product |
|----------|---------|---------|
| `POST /api/auth/signup` | User registration | All |
| `POST /api/auth/login` | User login (wallet, Google, email, etc.) | All |
| `GET /api/user/profile` | User profile + preferences | All |
| `PUT /api/user/watchlists` | Sync watchlists to database | All |
| `POST /api/trade/swap` | Execute on-chain swap | Lite + Pro |
| `POST /api/trade/limit-order` | Create limit order | Lite + Pro |
| `GET /api/trade/orders` | List active orders | Lite + Pro |
| `POST /api/wallet/create` | Generate custodial wallet | All |
| `POST /api/wallet/deposit` | Deposit address/instructions | All |
| `POST /api/wallet/withdraw` | Initiate withdrawal | All |
| `GET /api/wallet/balance` | Wallet balance | All |
| `GET /api/social/feed/:token` | Live X/social feed for token | All |
| `GET /api/social/sentiment/:token` | Sentiment score | All |
| `POST /api/agent/chat` | AI agent conversation (LLM) | All |
| `GET /api/safety/check/:contract` | Contract security audit | Lite + Pro |
| `POST /api/alerts` | Create price/sentiment alert | Research |
| `GET /api/alerts` | List user alerts | Research |

### Frontend Services

| Service File | Purpose | Lines |
|-------------|---------|-------|
| `src/services/codexApi.js` | Codex GraphQL queries | 518 |
| `src/services/binanceApi.js` | Binance REST (prices, klines) | 304 |
| `src/services/coinGeckoApi.js` | CoinGecko REST (prices, details, search) | 548 |
| `src/services/cryptoNewsApi.js` | CryptoPanic + RSS news | ~350 |
| `src/services/stockApi.js` | Alpha Vantage stock data | ~500 |
| `src/services/stockNewsApi.js` | Stock news aggregation | ~350 |
| `src/services/polymarketApi.js` | Polymarket prediction markets (mock) | ~200 |
| `src/services/projectLinksApi.js` | Token social/project links | ~250 |

### Custom Hooks

| Hook | Purpose | Data Source |
|------|---------|------------|
| `useCodexData` | Core data fetching: trending, search, prices, bars, details | Codex → CoinGecko → Binance |
| `useChartData` | OHLCV chart candle data | Codex bars → Binance klines |
| `useWatchlistPrices` | Real-time watchlist token prices (30s) | Binance |
| `useMarketIntel` | Smart money flows, market metrics | Calculated/mock |
| `useStockData` | Stock prices, news, market status | Alpha Vantage |
| `useMediaQuery` | Responsive breakpoint detection | Browser API |

---

## 10. State Management & Persistence

### Global State (App.jsx)

All global state lives in `App.jsx` via React `useState`. No external state management library.

| State Variable | Type | Purpose | Persisted |
|---------------|------|---------|-----------|
| `currentPage` | string | Active page ID | localStorage |
| `currentView` | string | 'welcome' or 'token' | — |
| `appDisplayMode` | string | 'terminal' or 'cinema' | localStorage |
| `globalDayMode` | boolean | Day/night theme | localStorage |
| `profile` | object | User name + avatar | localStorage |
| `token` | object | Currently selected token | localStorage |
| `watchlists` | array | All watchlists with tokens | localStorage |
| `activeWatchlistId` | string | Current active watchlist | localStorage |
| `marketMode` | string | 'crypto' or 'stocks' | localStorage |
| `chartViewMode` | string | 'trading', 'xChart', 'xBubbles' | — |
| Egg/Agent state | various | Egg progression, agent profile | localStorage |

### localStorage Keys

| Key | Data | Size Estimate |
|-----|------|--------------|
| `spectre-current-page` | Page ID string | <100B |
| `spectre-selected-token` | Token object (name, symbol, address, network) | ~500B |
| `spectre-watchlists` | Array of watchlist objects | 1-10KB |
| `spectre-active-watchlist-id` | Watchlist ID string | <100B |
| `spectre-app-display-mode` | 'terminal' or 'cinema' | <50B |
| `spectre-day-mode` | boolean | <50B |
| `spectre-market-mode` | 'crypto' or 'stocks' | <50B |
| `spectre-nav-sidebar-collapsed` | boolean | <50B |
| `spectre-profile` | { name, imageUrl } | ~200B |
| `spectre-weather` | Cached weather data | ~500B |
| `spectre-gamification` | Daily claim progress | ~200B |
| `spectre-chartType` | 'candles', 'line', or 'heatmap' | <50B |
| `spectre-timeframe` | '5', '15', '60', '240', 'D', 'W' | <50B |
| `spectre-egg-state` | Egg progression state | ~500B |

### Migration Path

When backend database is built, localStorage data must be migrated:
1. On first login after auth system deploys, read localStorage watchlists and upload to server
2. Server becomes source of truth; localStorage becomes offline cache
3. Implement sync strategy: server-authoritative with local fallback

---

## 11. Display Modes & Theming

### Display Mode Matrix

| Mode | Toggle Location | Scope | Status |
|------|----------------|-------|--------|
| **Terminal** (default) | Header toggle | Welcome page only | `DONE` |
| **Cinema** | Header toggle | Welcome page only | `DONE` — Only on welcome page per business reqs, expansion planned |
| **Day Mode** | Header sun icon | Global | `DONE` — Covers most pages |
| **Night Mode** (default) | Default state | Global | `DONE` |
| **Crypto Mode** | Header toggle | Global data sources | `DONE` |
| **Stocks Mode** | Header toggle | Global data sources | `PARTIAL` — Basic stock data |
| **Mobile Mode** | Auto-detect (<768px) | Layout + components | `DONE` |

### Day Mode Coverage

| Page/Component | Day Mode Support | Notes |
|---------------|-----------------|-------|
| WelcomePage | `DONE` | Dedicated `WelcomePage.day-mode.css` |
| Cinema Welcome | `DONE` | `.cinema-welcome.day-mode` selectors in cinema-mode.css |
| ResearchZoneLite | `DONE` | Full day mode with token color contrast system |
| TokenStorybook | `DONE` | Day mode brand color adaptation |
| WatchlistsPage | `DONE` | Light palette |
| DiscoverPage | `DONE` | Light palette |
| CategoriesPage | `DONE` | Light palette |
| FearGreedPage | `DONE` | Light palette |
| ROICalculatorPage | `DONE` | Light palette |
| MarketAnalyticsPage | `DONE` | Light palette |
| NavigationSidebar | `DONE` | Light palette |
| Header | `DONE` | Light palette |
| Mobile components | `DONE` | Mobile-specific day mode CSS in mobile-2026.css |
| HeatmapsPage | `PARTIAL` | Basic support |
| BubblesPage | `PARTIAL` | Basic support |
| XDashPage | `NOT DONE` | No day mode styles |
| XBubblesPage | `NOT DONE` | No day mode styles |
| SocialZonePage | `NOT DONE` | No day mode styles |
| MediaCenterPage | `NOT DONE` | No day mode styles |
| AI Charts pages | `NOT DONE` | No day mode styles |

### Token Color Contrast System

A brightness-aware color system ensures token brand colors are readable in both dark and day modes:

- **File:** `src/constants/tokenColors.js`
- **Functions:** `getColorBrightness()`, `lightenRgb()`, `darkenRgb()`, `getTokenDisplayColors()`
- **Problem solved:** Tokens like XRP (35,41,47), NEAR (0,0,0), APT (0,0,0), HBAR (0,0,0) have near-black brand colors that were invisible on dark backgrounds
- **Solution:** Automatic brightness detection → lighten for dark backgrounds, darken for light backgrounds
- **CSS pattern:** `var(--token-rgb-accent, var(--token-rgb))` with day mode swap via `.day-mode { --token-rgb-accent: var(--token-rgb-accent-day) }`

---

## 12. Mobile Platform

### Responsive Architecture

| Breakpoint | Target | Layout |
|-----------|--------|--------|
| < 768px | Mobile phones | Single column, bottom nav, swipeable rows |
| 768px–1024px | Tablets | 2-column grid, sidebar collapsed |
| > 1024px | Desktop | Full layout, sidebar expandable, 3-column token view |

### Mobile-Specific Components

| Component | File | Purpose |
|-----------|------|---------|
| MobileHeader | `MobileHeader.jsx` | Stripped header with essentials |
| MobileBottomNav | `MobileBottomNav.jsx` | 5-tab bottom navigation (Home, Discover, Favorites, Markets, More) |
| MobileBottomSheet | `MobileBottomSheet.jsx` | Swipeable action modal |
| MobileTabBar | `MobileTabBar.jsx` | Token view tab switcher |
| MobileSubpageHeader | `MobileSubpageHeader.jsx` | Consistent back-button header for subpages |
| SwipeableRow | `SwipeableRow.jsx` | Horizontal swipe for delete/edit actions |
| MobilePreviewFrame | `MobilePreviewFrame.jsx` | Device frame for testing (`?mobile=1`) |

### Mobile CSS

- **`src/styles/mobile-2026.css`** — Primary mobile stylesheet with 5,000+ lines
- **`src/styles/app-store-ready.css`** — App store guidelines compliance
- Touch targets: 44px minimum
- Safe area padding: `env(safe-area-inset-bottom)` for notch devices
- PWA standalone mode: Detected via `window.navigator.standalone`

### Mobile Optimizations Applied

- All infinite CSS animations killed on mobile
- `backdrop-filter: blur()` reduced from 50px to 16px on bottom nav, removed entirely on many elements
- React.memo() on Sparkline and CinemaTokenCard components
- requestAnimationFrame debouncing on scroll handlers
- CSS `contain: layout style paint` on repeated card elements
- GPU compositing via `transform: translateZ(0)` on scroll containers
- Removed phantom setInterval calls that caused unnecessary re-renders

---

## 13. AI Agent System

### Current Implementation

The AI Agent (currently "Monarch AI") consists of two subsystems:

#### Egg Progression System

| Stage | Trigger | UI | File |
|-------|---------|-----|------|
| Idle | App start | No egg visible | `useEggState.js` |
| Started | User clicks egg info | Egg appears | `SpectreEgg.jsx` |
| Cracking | User interactions accumulate | Crack animation | `SpectreEgg.jsx` |
| Hatching | Progress reaches 100% | Hatch animation | `SpectreEgg.jsx` |
| Born | After hatch | Agent FAB appears | `AgentFAB.jsx` |

**Purpose:** Gamified onboarding. The egg "learns" from user behavior (page views, searches, watchlist adds) and hatches into a personalized AI agent.

#### Agent Chat System

| Component | File | Purpose |
|-----------|------|---------|
| SpectreAgentChat | `agent/SpectreAgentChat.jsx` | Full chat interface with message history |
| AgentFAB | `agent/AgentFAB.jsx` | Floating action button (post-birth) |
| AgentAvatar | `agent/AgentAvatar.jsx` | Agent avatar rendering |
| agentProfile | `agent/agentProfile.js` | Agent personality config (name, color, level) |
| agentResponses | `agent/agentResponses.js` | Pre-written response templates |

### What Works Today

- Egg progression tracked across sessions (localStorage)
- Chat UI with message input and display
- @ mention for token context in chat
- Pre-written responses based on pattern matching (agentResponses.js)
- Agent FAB available on all pages after egg hatches

### What's Missing for Business Requirements

| Requirement | Status | Technical Solution |
|------------|--------|-------------------|
| LLM-powered responses | `NOT STARTED` | Connect to OpenAI/Anthropic API via backend endpoint |
| Platform data context | `NOT STARTED` | Pass current token data, watchlist, market state as LLM context |
| Web browsing capability | `NOT STARTED` | Tavily API or custom scraper via backend |
| Navigation commands | `PARTIAL` | Basic @ mention works. Full "open Research Zone for BTC" needs intent parser |
| Experience-level adaptation | `NOT STARTED` | User profile with experience level → adjust LLM system prompt |
| Rename from Monarch to Spectre AI Agent | `NOT STARTED` | UI label changes across all components |
| Trade execution (future) | `NOT STARTED` | Connect to on-chain execution layer with approval flow |

---

## 14. Gap Analysis — Missing Features & Technical Solutions

### Priority 0 — Required for Any Product Launch

#### 14.1 Authentication System

**Gap:** No real authentication. Currently uses a shared team password.

**Business Requirement:** Sign up/login via wallet (Phantom, MetaMask), Google, email, Discord, Telegram. Single account across all 3 products.

**Technical Solution:**
- **Backend:** Auth service with JWT tokens. Database for user accounts (PostgreSQL recommended).
- **Wallet auth:** Use `@solana/wallet-adapter` (Solana) + `wagmi`/`ethers.js` (EVM) for wallet connection. Sign-message-based auth (no private keys stored).
- **OAuth:** Google, Discord, Telegram via standard OAuth 2.0 flows. Use a library like `passport.js` on the server.
- **Session management:** JWT access tokens (15min) + refresh tokens (7d). HttpOnly cookies for security.
- **Cross-product SSO:** All 3 products share the same auth service domain. JWT is valid across all subdomains.

#### 14.2 User Database

**Gap:** All user data (watchlists, preferences, profile) is in localStorage. No cloud persistence. Data is lost if user clears browser.

**Technical Solution:**
- **Database:** PostgreSQL with tables for users, watchlists, preferences, alerts, trade history.
- **ORM:** Prisma or Drizzle for type-safe database access.
- **Migration strategy:** On first authenticated session, upload localStorage data to server. Server becomes authoritative. localStorage becomes offline cache with sync.
- **API:** RESTful endpoints for CRUD on all user data.

#### 14.3 Info Tooltip System

**Gap:** Zero tooltips exist. Business requirements state this is the education system and must be "visible by default on first visit."

**Technical Solution:**
- **Component:** Generic `<InfoTooltip content="..." />` React component wrapping any data point.
- **Content database:** JSON file or CMS with tooltip content per metric key (e.g., `market_cap`, `volume_24h`, `slippage`).
- **First-visit behavior:** Track `tooltipsSeen` in user preferences. Show all tooltips on first page visit. User can dismiss individually or toggle all off in settings.
- **Implementation:** ~200 tooltip placements across Research Platform. Can be done incrementally per page.

### Priority 1 — Core Product Differentiators

#### 14.4 AI Agent — LLM Integration

**Gap:** Agent uses pre-written response templates. Not connected to any LLM.

**Business Requirement:** Agent answers questions using platform data, browses web, researches projects.

**Technical Solution:**
- **Backend endpoint:** `POST /api/agent/chat` — accepts message + context (current token, page, watchlist).
- **LLM:** Anthropic Claude API (recommended for reasoning quality) or OpenAI GPT-4. System prompt includes platform data context.
- **Context injection:** Before each LLM call, inject: current token stats, recent price data, sentiment, news headlines, watchlist, user history.
- **Web research:** Use Tavily API for web search on demand. LLM decides when to search.
- **Streaming:** Server-Sent Events for real-time response streaming to frontend.
- **Cost management:** Rate limit per user. Cache common queries. Use smaller models for simple lookups.

#### 14.5 Live Social Data (X/Twitter)

**Gap:** All social/X data is mock. No live Twitter API integration.

**Business Requirement:** Real-time X feed per token, sentiment analysis, KOL tracking, social volume alerts.

**Technical Solution:**
- **X API v2:** Use Twitter/X API v2 with Bearer Token for token-specific searches. Filtered stream for real-time.
- **Backend pipeline:** `GET /api/social/feed/:token` — searches X for `$TOKEN` cashtags and token name mentions.
- **Sentiment analysis:** Run X posts through LLM for sentiment scoring (bullish/bearish/neutral). Aggregate into per-token sentiment score.
- **KOL tracking:** Maintain list of known crypto KOLs. Flag their posts with higher weight.
- **Rate limits:** X API has strict rate limits. Cache aggressively (5min TTL per query). Use streaming endpoint for high-volume tokens.
- **Fallback:** If X API rate-limited, show cached data with "last updated" timestamp.

#### 14.6 Prediction Markets — Real Data

**Gap:** Polymarket widget shows mock data.

**Technical Solution:**
- **Polymarket API:** Use Polymarket's public API (CLOB endpoint) to fetch real prediction markets.
- **Filtering:** Filter for crypto-related markets. Match to tokens where possible.
- **Display:** Existing UI components can be reused. Just need real data source.

### Priority 2 — Trading Platform Infrastructure

#### 14.7 Custodial Wallet System

**Gap:** No wallet system exists. Required for both Lite and Pro.

**Business Requirement:** Platform generates a trading wallet per user. User deposits funds, trades fast, withdraws anytime. (Like GmGn model.)

**Technical Solution:**
- **Wallet generation:** HD wallet derivation (BIP-44) per user per chain. Each user gets a deterministic wallet for Solana, Ethereum, BSC, etc.
- **Key management:** HSM (Hardware Security Module) or AWS KMS for master key. User wallet keys derived deterministically and never stored in plaintext.
- **Deposit flow:** Display deposit address → user sends crypto → backend monitors chain for incoming transactions → credit user balance.
- **Withdraw flow:** User initiates → backend signs and broadcasts transaction → debit user balance.
- **Balance tracking:** Real-time balance queries per chain via RPC nodes.
- **Security:** Multi-sig for large withdrawals. Rate limiting. 2FA for withdrawals above threshold.
- **Regulatory:** This is a custodial model — may require money transmitter licensing depending on jurisdiction. Legal review required.

#### 14.8 On-Chain Swap Execution

**Gap:** No trading functionality exists.

**Technical Solution:**
- **Solana:** Jupiter Aggregator API for best-price routing across DEXs.
- **EVM chains (ETH, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche):** 1inch or 0x API for aggregated routing.
- **Execution flow:** User confirms → backend fetches optimal route → signs transaction with custodial wallet key → broadcasts → monitor for confirmation → update balance.
- **Speed optimization:** Pre-built transactions, priority fee management, dedicated RPC endpoints.
- **Fee collection:** Inject 1% platform fee into swap transaction or take fee separately.

#### 14.9 Safety/Security Checks

**Gap:** No contract verification, honeypot detection, or LP analysis.

**Technical Solution:**
- **GoPlus Security API:** Real-time token security assessment (honeypot, proxy contract, mint authority, LP locked, etc.).
- **De.Fi / Token Sniffer:** Additional security data sources.
- **Custom heuristics:** LP size vs market cap ratio, holder concentration (top 10 > 50% = warning), dev wallet activity.
- **Display:** Green/yellow/red risk indicator on every token. Detailed breakdown expandable. Warning modal before swapping high-risk tokens.

#### 14.10 Limit Orders & Conditional Orders

**Gap:** No order system exists.

**Technical Solution:**
- **Backend order book:** PostgreSQL table for pending orders. Background worker monitors price feeds.
- **Trigger logic:** When price condition met → execute swap via execution layer.
- **Order types:** Limit buy, limit sell, take-profit, stop-loss.
- **For Pro:** Advanced conditions (partial fills, expiry, trailing stop).

### Priority 3 — Enhancement & Polish

#### 14.11 Alert/Notification System

**Gap:** No price alerts, sentiment alerts, or whale activity notifications.

**Technical Solution:**
- **Backend:** Alert service with rules engine. User creates alert (e.g., "BTC > $100K") → stored in database → price monitor evaluates → triggers notification.
- **Delivery:** In-app notification bell + push notifications (Web Push API) + optional email.
- **Alert types:** Price threshold, % change, sentiment shift, whale transaction, social volume spike.

#### 14.12 Rename "Monarch AI" to "Spectre AI Agent"

**Gap:** UI still references "Monarch AI Chat" in multiple places.

**Technical Solution:**
- Search-and-replace across all JSX and CSS files.
- Estimated scope: ~15 file changes.

#### 14.13 Product Tour / Onboarding

**Gap:** No guided first-run experience.

**Technical Solution:**
- Use a library like `react-joyride` or `shepherd.js` for step-by-step product tour.
- Trigger on first visit (track in user preferences).
- ~10 steps covering: search, watchlist, token detail, chart, AI agent.

#### 14.14 Data Source Attribution

**Gap:** Data sources not clearly shown.

**Technical Solution:**
- Small "Powered by Codex" / "Data: CoinGecko" labels on relevant sections.
- Tooltip on data points indicating source and last-updated time.

#### 14.15 AI Disclaimer

**Gap:** No "not financial advice" disclaimer on AI outputs.

**Technical Solution:**
- Static disclaimer text on AI chat page and at bottom of AI-generated content.
- Can be a simple React component rendered in relevant locations.

#### 14.16 Subscription / $SPECTRE Token Gating

**Gap:** No premium tier or token-gating.

**Technical Solution:**
- **Token gating:** Read on-chain balance of $SPECTRE token. If balance > threshold, unlock premium features.
- **Subscription:** Stripe for fiat payments. Backend verifies subscription status.
- **Feature flags:** Server-side feature flags per user tier (free, premium, whale).

---

## 15. Technical Debt

### Large Files Needing Refactoring

| File | Lines | Issue | Recommendation |
|------|-------|-------|----------------|
| `WelcomePage.jsx` | 6,844 | Monolithic component with inline discovery logic | Split into sub-components (WelcomeHero, WelcomeDiscovery, WelcomeWidgets) |
| `server/index.js` | 3,289 | All endpoints in one file | Split into route modules (auth, tokens, trading, social) |
| `App.jsx` | 1,112 | All global state and routing logic | Extract state to context providers or Zustand store |
| `WelcomePage.cinema-mode.css` | ~2,650 | Massive CSS file | Consider CSS modules or extract per-component |
| `mobile-2026.css` | ~5,000 | Mobile overrides for everything | Consider colocating mobile CSS with components |

### Incomplete Pages

| Page | Issue | Action |
|------|-------|--------|
| XDashPage | Stub with basic layout | Needs live X API + real content |
| SocialZonePage | Stub | Needs social data pipeline |
| MediaCenterPage | Stub | Needs news aggregation content |
| AIChartsLabPage | Minimal | Define purpose or remove |
| AI Charts page | Basic | Define what "AI-enhanced charts" means |

### Mock Data Dependencies

| Component | Mock Data | Action Needed |
|-----------|-----------|---------------|
| Social/X feed | Mock tweets array | Connect X API |
| Polymarket widget | Hardcoded prediction data | Connect Polymarket API |
| Agent responses | Pattern-matched templates | Connect LLM API |
| AI signals/logs | Generated agent messages | Connect to real agent pipeline |
| Smart Money Pulse | Calculated metrics | Connect to real on-chain analytics |

### Known Issues

- WebSocket connection: Attempted on localhost only. Falls back to REST polling on production (Vercel). Needs proper WebSocket infrastructure for real-time data.
- Some stock features require Alpha Vantage paid tier for reliable data.
- Chart component is complex (~1,500 lines) and could benefit from extraction into smaller sub-components.
- No error boundary on most pages (only GMDashboard has one).

---

## 16. Recommended Roadmap

### Phase 1: Backend Foundation (Weeks 1–4)

**Goal:** Build the shared infrastructure that all 3 products need.

| Week | Deliverable | Details |
|------|------------|---------|
| 1–2 | **Authentication service** | User registration/login (wallet + Google + email). JWT-based sessions. User database (PostgreSQL). |
| 2–3 | **User data API** | Migrate watchlists, preferences, profile from localStorage to database. Sync strategy. |
| 3–4 | **AI Agent backend** | `POST /api/agent/chat` endpoint connected to Claude/GPT. Platform data context injection. Streaming responses. |
| 4 | **Social data pipeline** | X API v2 integration. Per-token social feed. Basic sentiment scoring. |

### Phase 2: Research Platform Polish (Weeks 5–8)

**Goal:** Bring the existing Research Platform to production quality.

| Week | Deliverable | Details |
|------|------------|---------|
| 5 | **Info tooltip system** | Generic tooltip component. Content for top 50 most-used metrics. First-visit behavior. |
| 5–6 | **AI Agent UX** | Rename Monarch → Spectre AI Agent. Connect to LLM backend. Platform data context. |
| 6–7 | **Live social integration** | Replace mock tweets with real X data. Sentiment display. |
| 7 | **Onboarding tour** | Product tour for first-time users (react-joyride or similar). |
| 8 | **Polish & testing** | Day mode gaps (X Dash, Social Zone, etc.). Error boundaries. Data attribution. AI disclaimer. |

### Phase 3: Trading Platform Lite (Weeks 9–14)

**Goal:** Build the integrated Lite trading experience inside the Research Platform + standalone app.

| Week | Deliverable | Details |
|------|------------|---------|
| 9–10 | **Custodial wallet service** | HD wallet generation, key management, deposit/withdraw API. |
| 10–11 | **Swap execution layer** | Jupiter (Solana) + 1inch/0x (EVM). Multi-chain routing. |
| 11–12 | **Swap widget UI** | Clean swap component embedded in Research Platform right panel. Amount input, token selector, fee display, confirm flow. |
| 12–13 | **Safety checks** | GoPlus integration. Honeypot detection. Risk indicator. Warning modals. |
| 13 | **Limit orders** | Backend order service. Price monitoring. Automatic execution. |
| 14 | **Standalone Lite app** | Separate route/build at trade.spectreai.io/lite with own discover page. |

### Phase 4: Trading Platform Pro (Weeks 15–20)

**Goal:** Build the competitive pro trading terminal.

| Week | Deliverable | Details |
|------|------------|---------|
| 15–16 | **Pro discover page** | New launches feed, trending memecoins, social volume spikes, smart money moves. |
| 16–17 | **Advanced swap** | Fee/tip config, slippage settings, pre-set amounts, one-click trading. |
| 17–18 | **Sniper & speed tools** | New token launch detection, instant execution, priority fees. |
| 18–19 | **Copy trading** | Wallet tracking, trade mirroring, smart money intent signals. |
| 19–20 | **AI risk scoring** | Multi-signal aggregation. Green/yellow/red indicator. Plain-language risk summary. |

### Phase 5: Scale & Monetization (Weeks 21+)

| Deliverable | Details |
|-------------|---------|
| **Alert system** | Price, sentiment, whale alerts. Push notifications. |
| **Subscription/token gating** | Premium tier. $SPECTRE token holding check. |
| **Analytics** | User behavior tracking. Funnel analytics. Performance monitoring. |
| **Take-profit / stop-loss** | Advanced conditional orders for Pro. |
| **AI Agent trade execution** | Agent can execute trades with explicit user approval. Full audit trail. |
| **ElevenLabs voice briefs** | AI-generated audio market summaries per token. |

---

## 17. File Reference

### Component Files (src/components/)

| File | Lines | Purpose |
|------|-------|---------|
| WelcomePage.jsx | 6,844 | Landing/discovery page |
| ResearchZoneLite.jsx | 1,234 | Token research page |
| TradingChart.jsx | ~1,500 | Chart component (candlestick/line/heatmap) |
| TokenBanner.jsx | ~400 | Token header (symbol, price, change) |
| TokenStorybook.jsx | ~800 | Cinema mode token biography |
| DiscoverPage.jsx | ~600 | Editorial token discovery |
| WatchlistsPage.jsx | ~700 | Multi-watchlist manager |
| Header.jsx | ~600 | Top navigation bar |
| NavigationSidebar.jsx | ~500 | Left collapsible sidebar |
| DataTabs.jsx | ~400 | Token metrics table |
| LeftPanel.jsx | ~400 | Token view left sidebar |
| RightPanel.jsx | ~500 | Token view right sidebar |
| GMDashboard.jsx | ~600 | Zen daily dashboard |
| GlassSelect.jsx | ~200 | Custom glassmorphic select |
| AuthGate.jsx | ~100 | Team password gate (temporary) |
| MobileBottomNav.jsx | ~300 | Mobile bottom navigation |
| MobileHeader.jsx | ~250 | Mobile header |
| MobileBottomSheet.jsx | ~300 | Mobile action sheet |
| SwipeableRow.jsx | ~200 | Swipeable list row |

### Cinema Mode (src/components/cinema/)

| File | Purpose |
|------|---------|
| CinemaWelcomeWrapper.jsx | Root orchestrator + LiveChartBackground |
| CinemaWelcomeBar.jsx | Top bar with price widgets |
| CinemaDiscovery.jsx | Netflix-style horizontal rows |
| CinemaWatchlistSidebar.jsx | Fixed right sidebar |
| CinemaCommandCenter.jsx | AI command palette |
| CinemaAIBrief.jsx | AI market briefings |
| CinemaResearchZone.jsx | Cinema research zone |

### Egg/Agent System

| File | Purpose |
|------|---------|
| egg/useEggState.js | Egg progression state machine |
| egg/SpectreEgg.jsx | Egg animation component |
| egg/EggExplainerModal.jsx | Egg info modal |
| egg/EggStateManager.js | State persistence |
| agent/SpectreAgentChat.jsx | Chat interface |
| agent/AgentFAB.jsx | Floating action button |
| agent/AgentAvatar.jsx | Avatar renderer |
| agent/agentProfile.js | Personality configuration |
| agent/agentResponses.js | Response templates |

### Stylesheets

| File | Lines | Purpose |
|------|-------|---------|
| WelcomePage.cinema-mode.css | ~2,650 | Cinema mode styling |
| WelcomePage.css | ~2,000 | Terminal mode welcome styles |
| WelcomePage.day-mode.css | ~500 | Day mode overrides for welcome |
| mobile-2026.css | ~5,000 | All mobile responsive CSS |
| app-store-ready.css | ~300 | App store compliance |
| ResearchZoneLite.css | ~1,500 | Research zone styling |
| CinemaResearchZone.css | ~1,000 | Cinema research zone |
| index.css | ~800 | Global styles + CSS variables |

### Services & Hooks

| File | Purpose |
|------|---------|
| services/codexApi.js | Codex GraphQL (primary data) |
| services/binanceApi.js | Binance REST (prices, klines) |
| services/coinGeckoApi.js | CoinGecko REST (fallback) |
| services/cryptoNewsApi.js | CryptoPanic + RSS |
| services/stockApi.js | Alpha Vantage stocks |
| services/stockNewsApi.js | Stock news |
| services/polymarketApi.js | Prediction markets (mock) |
| services/projectLinksApi.js | Token social links |
| hooks/useCodexData.js | Core data fetching hook |
| hooks/useChartData.js | Chart data hook |
| hooks/useWatchlistPrices.js | Watchlist live prices |
| hooks/useMarketIntel.js | Market intelligence |
| hooks/useStockData.js | Stock data hook |
| hooks/useMediaQuery.js | Responsive detection |

### Server

| File | Purpose |
|------|---------|
| server/index.js | Express server — API proxy + caching (3,289 lines) |
| server/routes/posting.js | Content posting API |
| server/.env | API keys (not committed) |

### Configuration & Documentation

| File | Purpose |
|------|---------|
| CLAUDE.md | Project overview for AI assistants |
| DESIGN_SYSTEM.md | Design tokens and component patterns |
| Spectre_AI_Business_Requirements.md | Business requirements (3 products) |
| docs/APP_STRUCTURE.md | Canonical app architecture |
| docs/API_PLAN.md | Data integration strategy |
| docs/SPECTRE_APP_PLAN_DONE_AND_NEXT.md | Progress tracker |
| docs/SETUP_APIS.md | Environment setup guide |
| docs/DEPLOY_VERCEL.md | Deployment instructions |
| docs/RESEARCH_ZONE_LITE_PLAN.md | Research zone specification |
| docs/MOBILE_AGENT_PLAN.md | Mobile-first development rules |
| STOCK_MODE_IMPLEMENTATION_PLAN.md | Stock market expansion plan |
| spectre-agent-spec.md | AI agent personality specification |

---

## Summary

### What We Have

The **Research Platform frontend** is ~70% built with 21 pages, dual display modes (Terminal/Cinema), day/night theming, full mobile responsive design, real-time data from 3 API sources, interactive charting, multi-watchlist management, and a gamified AI agent system.

### What We Need

1. **Backend infrastructure** — Authentication, user database, API endpoints for persistent data
2. **AI Agent intelligence** — LLM connection, platform data context, web research capability
3. **Live social data** — X/Twitter API integration replacing mock data
4. **Education layer** — Info tooltips on every metric (business requirement: visible by default)
5. **Trading execution** — Custodial wallets, on-chain swap, limit orders (for Lite and Pro products)
6. **Safety systems** — Honeypot detection, contract verification, risk scoring

### What This Means for the Backend Team

The frontend is architected around a proxy server at port 3001. The backend team can:

1. **Replace the proxy** with a full API server maintaining the same endpoint signatures
2. **Add new endpoints** for auth, user data, trading, social — frontend will consume them
3. **Build shared services** (wallet, execution, safety) that both Lite and Pro frontends will use
4. **The data flow pattern is established** — hooks call services, services call server, server calls external APIs. New backend endpoints slot into this pattern naturally.

---

*This document should be updated with every PR. Every new feature gets a row in the relevant feature inventory table. Every new API endpoint gets documented. Status labels get updated as features move from NOT STARTED → PARTIAL → DONE.*

*Generated: February 10, 2026*
*Reference: Spectre_AI_Business_Requirements.md*
