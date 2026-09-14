# Spectre Sunny Trading Platform - Engineering Bible

*Last updated: 2026-02-13*
*Compiled from 8 parallel subagent analyses*

---

## 📋 Executive Summary

**Spectre Sunny** is a production-ready cryptocurrency trading platform built with React + Express. Features real-time token data, multi-chain support, an AI assistant, gamification, and a cinema-immersion mode.

| Metric | Value |
|--------|-------|
| Components | 100+ React components |
| Lines of Code | ~50,000+ |
| API Integrations | 9 services (Codex, CoinGecko, Binance, etc.) |
| Theme Modes | 3 (Dark, Day, Cinema) |
| Languages | 8 (i18n) |
| AI Features | Agent system + Monarch AI |

---

## 1. ARCHITECTURE OVERVIEW

### 1.1 Tech Stack
| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18.2 + Vite 5.0 |
| **Backend** | Express.js 4.18 (dev) / Vercel Serverless (prod) |
| **Routing** | React Router DOM v7 |
| **State** | React Context + localStorage |
| **Animation** | CSS animations + Framer Motion (limited) |
| **Video** | Remotion 4.0 |
| **Voice** | ElevenLabs SDK |
| **TTS** | Edge TTS + ElevenLabs |
| **i18n** | i18next + react-i18next |

### 1.2 Project Structure
```
~/clawd/spectre-sunny/
├── src/
│   ├── components/         # 100+ React components (co-located .css files)
│   ├── hooks/             # 7 custom hooks (useCodexData, useStockData, etc.)
│   ├── services/          # 9 API clients
│   ├── lib/               # Utilities (currency, formatters, TTS)
│   ├── constants/         # Static data (tokenColors, stockData, pageRoutes)
│   ├── contexts/          # 2 contexts (I18nCurrency, MobilePreview)
│   ├── i18n/              # 8 language files
│   ├── icons/             # spectreIcons.jsx (40+ icons)
│   ├── remotion/          # Video composition components
│   ├── styles/            # mobile-2026.css, app-store-ready.css
│   ├── App.jsx            # Main app (~1,150 lines)
│   └── main.jsx           # React mount
├── server/                # Express backend (~5,200 lines)
├── api/                   # Vercel serverless functions (production)
├── packages/spectre-ui/   # Component library (7 components)
└── docs/                  # Architecture documentation
```

### 1.3 Entry Points
| Entry | Purpose |
|-------|---------|
| `src/main.jsx` | React bootstrap, i18n init |
| `src/App.jsx` | Global state, routing, 3-column layout |
| `server/index.js` | Express API server (dev) |
| `packages/spectre-ui/src/index.ts` | UI package exports |

### 1.4 Environment Variables
```bash
# Required
CODEX_API_KEY=xxx

# Optional AI
ANTHROPIC_API_KEY=xxx
OPENAI_API_KEY=xxx

# Optional Data
COINGECKO_API_KEY=xxx
TAVILY_API_KEY=xxx
SERPAPI_KEY=xxx
CRYPTOPANIC_API_KEY=xxx
TWITTER_BEARER_TOKEN=xxx
```

---

## 2. COMPONENT ARCHITECTURE

### 2.1 Component Organization Pattern
**Co-located CSS Files** (not CSS Modules, not CSS-in-JS)
```
ComponentName.jsx
ComponentName.css
```

**Multi-Theme CSS Pattern:**
```css
ComponentName.css           /* Dark theme (default) */
ComponentName.day-mode.css  /* Light theme */
ComponentName.cinema-mode.css /* Cinema mode */
```

### 2.2 Naming Conventions
| Type | Pattern | Example |
|------|---------|---------|
| Pages | `*Page.jsx` | `WelcomePage`, `DiscoverPage` |
| Features | `*Zone.jsx`, `*Dashboard.jsx` | `ResearchZonePro`, `GMDashboard` |
| UI Components | PascalCase | `GlassSelect`, `TradingChart` |
| Mobile Specific | `Mobile*.jsx` | `MobileHeader`, `MobileBottomNav` |

### 2.3 Key Page Components

#### WelcomePage (~445KB, 12,000+ lines)
- Landing page / Token Discovery Hub
- Real-time token data from Codex API
- Stock + Crypto dual mode
- On-chain data tables with boost indicators
- Cinema mode wrapper support
- **Data Sources**: CoinGecko, Binance, Codex API, Crypto News API

#### TradingChart (~163KB)
- Custom canvas-based rendering (no TradingView embed)
- Zoom, pan, crosshair interactions
- X Mentions overlay (social signals on price action)
- Multiple chart types: candles, line, area, bubbles
- Heatmap overlay
- localStorage persistence for timeframe preferences

#### ResearchZonePro / ResearchZoneLite (~60KB-93KB each)
- Token research deep-dive interface
- **Pro**: Full-featured with prediction markets, deep metrics
- **Lite**: Streamlined version for quick research
- Both use `TOKEN_ROW_COLORS` for consistent token branding

#### DataTabs (~84KB)
- Tabbed data display below charts
- **Tabs**: Transactions History, Holders, On-Chain Bubblemap, X Bubblemap
- Real-time trades from Codex API with maker type detection

### 2.4 Reusable UI Component Patterns

#### A. Glassmorphism Components
```jsx
// GlassSelect - Mobile-native dropdown
<GlassSelect 
  value={timeframe} 
  onChange={handleChange}
  options={TIME_OPTIONS}
  ariaLabel="Select timeframe"
/>
```

#### B. Mobile Compound Pattern
```
MobileHeader      -> Top bar with hamburger
MobileBottomNav   -> Bottom tab bar
MobileBottomSheet -> Slide-up panels (drag-to-dismiss)
MobileTabBar      -> In-page tabs
MobileSubpageHeader -> Navigation for subpages
SwipeableRow      -> Touch/swipe interactions
```

#### C. Agent/Egg System (Gamification)
```
egg/
  SpectreEgg.jsx        -> Visual SVG egg with neural network
  EggExplainerModal.jsx -> Educational modal
  useEggState.js        -> State management hook
  EggStateManager.js    -> Global state logic

agent/
  SpectreAgentChat.jsx  -> Chat interface
  AgentAvatar.jsx       -> Visual avatar component
  AgentFAB.jsx          -> Floating action button
  agentProfile.js       -> Type assignment logic
  agentResponses.js     -> Conversation flows
```

#### D. Cinema Mode Components
```
cinema/
  CinemaResearchZone.jsx    -> Immersive research view
  CinemaWelcomeBar.jsx      -> Top hero bar
  CinemaDiscovery.jsx       -> Discovery in cinema mode
  CinemaCommandCenter.jsx   -> Control interface
  CinemaWatchlistSidebar.jsx -> Side panel
  CinemaAIBrief.jsx         -> AI-generated briefings
  BriefAudioPlayer.jsx      -> Text-to-speech playback
```

### 2.5 Component Hierarchy
```
App.jsx (Router + Layout)
├── Header / MobileHeader
├── NavigationSidebar (Desktop)
├── LeftPanel (Watchlists)
├── Main Content Area
│   ├── WelcomePage / ResearchZonePro
│   ├── TradingChart + DataTabs
│   └── [Page Components]
├── RightPanel (Details)
├── MobileBottomNav (Mobile)
└── Agent System (Floating)
    ├── SpectreEgg
    └── SpectreAgentChat
```

### 2.6 Composition Patterns

**1. Container/Presentational Split**
```jsx
// Hook-based data fetching (container logic)
const { tokenData } = useTokenDetails(address, networkId, refreshMs)
const { fmtPrice } = useCurrency()

// Presentational component receives processed data
<TradingChart token={processedToken} stats={stats} />
```

**2. Render Props for Customization**
```jsx
// DataTabs uses internal formatting but accepts data
<DataTabs 
  token={token}
  trades={latestTrades}
  // Internal renderers for different tab content
/>
```

**3. Portal-Based Overlays**
```jsx
import { createPortal } from 'react-dom'

// Used for: Modals, dropdowns, tooltips, agent chat
// Renders outside standard DOM tree for z-index control
```

### 2.7 Mobile vs Desktop Strategies

**A. Detection Pattern**
```jsx
// Custom hook approach
const isMobile = useIsMobile()  // 768px breakpoint or <1400px
const [isMobile, setIsMobile] = useState(window.innerWidth < 1400)
```

**B. Adaptive Component Strategy**
| Desktop | Mobile |
|---------|--------|
| Header | MobileHeader |
| NavigationSidebar | MobileBottomNav + hamburger menu |
| LeftPanel (side) | Full-screen or bottom sheet |
| RightPanel (side) | Collapsible or tabbed |
| Hover interactions | Touch/swipe gestures |
| Multi-column | Single column with tabs |

**C. Mobile-First CSS Pattern**
```css
/* Base mobile styles */
.component { padding: 16px; }

/* Tablet */
@media (min-width: 768px) { ... }

/* Desktop */
@media (min-width: 1400px) { ... }
```

**D. Touch Interaction Components**
- **SwipeableRow**: Swipe-to-reveal actions
- **MobileBottomSheet**: Drag-to-dismiss panels
- **GlassSelect**: Touch-optimized dropdown (no native select)

**E. Performance Optimizations**
```jsx
// HeaderClock isolated with React.memo
const HeaderClock = memo(({ timeFormat }) => { ... })
// Prevents entire Header re-render every second
```

### 2.8 Design Patterns Summary

| Pattern | Usage |
|---------|-------|
| **Co-located CSS** | Every component (Component.jsx + Component.css) |
| **CSS Variables** | Theming (sentiment colors, glass effects) |
| **Custom Hooks** | Data fetching, media queries, currency formatting |
| **Context API** | App-level state (currency, i18n, mobile preview) |
| **localStorage** | User preferences persistence |
| **React.memo** | Performance (HeaderClock, list items) |
| **createPortal** | Modals, dropdowns, chat z-index control |
| **useRef + Canvas** | TradingChart custom rendering |
| **Subdirectories** | Feature grouping (agent/, cinema/, egg/) |

### 2.9 Key Component Relationships

```
Header ─────────────────┐
   │                    │
   │ provides search    │ controls
   ▼                    ▼
WelcomePage ◄───────► ResearchZonePro
   │                        │
   │ opens                  │ uses
   ▼                        ▼
TradingChart ◄───────► DataTabs
   │
   ├── uses ──► useCodexData (real-time)
   ├── uses ──► useCurrency (formatting)
   └── renders ──► X Mentions bubbles
```

**Data Flow**: Hooks → Container Components → Presentational Components → CSS Variables for theming

---

## 3. DESIGN SYSTEM

### 3.1 CSS Architecture
| Location | Purpose | Size |
|----------|---------|------|
| `src/index.css` | Global tokens, reset, utilities, animations | 28KB |
| `src/App.css` | Main 3-column layout, responsive grid | 23KB |
| `src/styles/mobile-2026.css` | Mobile-first optimizations | 6KB |
| Component CSS | 60+ component-specific styles | Varies |
| `packages/spectre-ui/` | Reusable UI component library | Package |

**Architecture Patterns:**
- **Token-based**: CSS custom properties at `:root`
- **Namespace strategy**: App uses `--*`, package uses `--spectre-*`, components use `--wp-*` / `--cinema-*`
- **BEM-inspired naming**: `.spectre-btn--primary`, `.glass-card`, `.animate-fade-up`

### 3.2 Design Tokens

#### Background Hierarchy
```css
--bg-void: #000000         /* Deepest black */
--bg-base: #0c0c0e         /* Main background */
--bg-surface: #131316      /* Card surfaces */
--bg-elevated: #1a1a1f     /* Elevated elements */
--bg-overlay: #222228      /* Modals/overlays */
--bg-hover: #2a2a30        /* Hover states */
```

#### Text Hierarchy (Alpha-Based)
```css
--text-primary: rgba(255,255,255,1)
--text-secondary: rgba(255,255,255,0.72)
--text-tertiary: rgba(255,255,255,0.48)
--text-muted: rgba(255,255,255,0.32)
```

#### Spacing Scale (4px base)
```css
--sp-1: 4px    --sp-2: 8px    --sp-3: 12px   --sp-4: 16px
--sp-5: 20px   --sp-6: 24px   --sp-8: 32px   --sp-10: 40px
```

#### Border Radius
```css
--radius-xs: 4px   --radius-sm: 8px   --radius-md: 12px
--radius-lg: 16px  --radius-xl: 24px  --radius-2xl: 32px
--radius-full: 9999px
```

#### Shadow System
| Class | Usage |
|-------|-------|
| `.shadow-sm` | Subtle elevation |
| `.shadow-md` | Cards, panels |
| `.shadow-lg` | Modals, dropdowns |
| `.shadow-glow` | Interactive elements |

#### Trading Colors
```css
--bull: #10B981;           /* Green for gains */
--bull-glow: rgba(16,185,129,0.4);
--bear: #EF4444;           /* Red for losses */
--bear-glow: rgba(239,68,68,0.4);
--accent: #8B5CF6;         /* Purple */
--accent-glow: rgba(139, 92, 246, 0.5);
--accent-gradient: linear-gradient(135deg, #8B5CF6 0%, #6366F1 50%, #4F46E5 100%);
```

#### Typography
```css
--font-display: 'Space Grotesk', system-ui;   /* Headings, titles */
--font-body: 'Inter', system-ui;              /* Body text, UI */
--font-mono: 'JetBrains Mono', 'Fira Code', monospace; /* Code, prices */
--font-glass: 'Outfit', system-ui;            /* Glass UI elements */
--font-cinema: 'Playfair Display', serif;     /* Cinema mode editorial */
```

**Typography Scale:**
| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | 0.75rem (12px) | Labels, timestamps |
| `--text-sm` | 0.875rem (14px) | Secondary text |
| `--text-base` | 1rem (16px) | Body text |
| `--text-lg` | 1.125rem (18px) | Emphasis |
| `--text-xl` | 1.25rem (20px) | Section headers |
| `--text-2xl` | 1.5rem (24px) | Page titles |
| `--text-3xl` | 1.875rem (30px) | Hero text |

### 3.3 Theme System

| Mode | Background | Accent | Key Feature |
|------|-----------|--------|-------------|
| **Dark** | #0c0c0e | Purple gradient | Glassmorphism default |
| **Day** | #f5f5f7 | Sentiment-driven | Bullish green / Bearish red |
| **Cinema** | Netflix-style | Editorial | Full-bleed, breathing sentiment wall |

**Theme Implementation:**
```typescript
// ThemeProvider.tsx
export type ThemeMode = 'dark' | 'light' | 'system';
// - Persisted to localStorage
// - Syncs with system preference
// - Applies class: .spectre-dark / .spectre-light
```

**Day Mode Sentiment Colors:**
| Market State | Color | Usage |
|-------------|-------|-------|
| Bullish | #1EBE78 (Fresh green) | Positive indicators |
| Bearish | #EB4646 (Warm red) | Negative indicators |
| Neutral | #6E64F0 (Soft indigo) | Neutral state |

**Top Accent Line:** Multi-color gradient (BTC orange → Purple → ETH blue)

### 3.4 Glass Morphism Pattern
```css
.glass {
  background: rgba(19, 19, 22, 0.85);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid transparent;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}

.glass:hover {
  border-color: rgba(255,255,255,0.08);
  transform: translateY(-2px);
}
```

#### Glass Variants
| Class | Blur | Use Case |
|-------|------|----------|
| `.glass` | 24px | Main panels, modals |
| `.glass-subtle` | 12px | Secondary overlays |
| `.glass-card` | 20px + gradient | Interactive cards with hover lift |

### 3.5 Animation & Motion Patterns

#### Easing Curves (Custom)
```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* Apple-style smooth */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);   /* Standard Material */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* Bouncy effect */
```

#### Duration Scale
```css
--duration-instant: 100ms   /* Hover micro-interactions */
--duration-fast: 150ms      /* Button clicks, toggles */
--duration-base: 250ms      /* Card hovers, modal opens */
--duration-slow: 400ms      /* Page transitions */
--duration-slower: 600ms    /* Complex entrance */
```

#### Keyframe Animations (CSS)
| Class | Animation | Use |
|-------|-----------|-----|
| `.animate-fade-up` | fadeInUp (translateY + opacity) | Entrances, scroll reveals |
| `.animate-scale` | scaleIn (0.95 → 1) | Modal opens, card selection |
| `.animate-slide-left` | slideInLeft | Side panel reveals |
| `.animate-pulse` | opacity pulse 2s infinite | Loading states, live indicators |
| `.animate-breathe` | box-shadow glow breathe 3s | Ambient sentiment wall |
| `.animate-float` | translateY float 4s | Gentle floating elements |
| `.animate-shimmer` | background-position shimmer 2s | Skeleton loaders |

#### Stagger Delays
```css
.stagger-1 { animation-delay: 50ms; }
.stagger-2 { animation-delay: 100ms; }
.stagger-3 { animation-delay: 150ms; }
/* ... up to 10 */
```

#### ⚠️ Framer Motion Status
- **Installed**: v12.33.0
- **Usage**: Minimal — CSS animations preferred
- **Where used**: Remotion video compositions only
- **Not used for**: UI transitions, hovers, entrances

### 3.6 Responsive Breakpoints
```css
@media (max-width: 768px)   /* Mobile */
@media (max-width: 900px)   /* Tablet */
@media (max-width: 1200px)  /* Hide left panel */
@media (max-width: 1400px)  /* Narrow columns */
@media (max-width: 1600px)  /* Slightly narrow */
```

#### Grid Evolution
```
1600px+:  380px | 1fr | 380px
1400px:   300px | 1fr | 300px
1200px:   hidden | 1fr | 320px
Mobile:   1fr (single column)
```

---

## 4. STATE MANAGEMENT

### 4.1 Architecture
**No external state libraries** (no Redux, Zustand, etc.)
- React Context: 2 providers
- React Hooks: 20+ custom hooks
- localStorage: Persistent user preferences
- Module singletons: Shared resources (WebSocket)

### 4.2 Context Providers

#### I18nCurrencyContext
```jsx
const { 
  fmtPrice,           // Format price with currency
  setLanguage,        // Switch language
  setCurrency,        // Switch currency
  exchangeRate        // Current rate
} = useCurrency()
```

#### MobilePreviewContext
```jsx
const { isMobilePreview } = useContext(MobilePreviewContext)
// Boolean flag for mobile preview mode
```

### 4.3 Custom Hooks

| Hook | Purpose | Key Features |
|------|---------|--------------|
| `useCodexData` | Token data from Codex API | GraphQL queries, caching |
| `useStockData` | Stock market data | Polling, multi-API aggregation |
| `useWatchlistPrices` | Watchlist price tracking | Multi-source, auto-refresh |
| `useMarketIntel` | Market data aggregation | Ref-based derived data |
| `useWhisperSearch` | Natural language search | Debounced, LLM-parsed |
| `useMediaQuery` | Responsive detection | 768px breakpoint |
| `useCurrency` | Combined i18n + currency | From I18nCurrencyContext |

### 4.4 Data Fetching Patterns

#### Pattern A: Polling with Interval
```javascript
// useStockPrices, useTrendingTokens
useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, refreshMs);
  return () => clearInterval(interval);
}, [dependency]);
```

#### Pattern B: Debounced Search
```javascript
// useStockSearch, useTokenSearch
useEffect(() => {
  const timer = setTimeout(() => {
    if (searchQuery) fetchResults();
  }, 300); // 300ms debounce
  return () => clearTimeout(timer);
}, [searchQuery]);
```

#### Pattern C: WebSocket + REST Hybrid
```javascript
// useRealtimePrice
// - WebSocket for live updates
// - REST as fallback/reconnection
```

### 4.5 localStorage Keys
| Key | Purpose |
|-----|---------|
| `spectre-currency` | Currency preference |
| `spectre-language` | Language preference |
| `spectreEgg` | Gamification state machine |
| `spectreAgent` | Post-hatch agent profile |
| `spectre_token_prices_cache` | Price cache (5-min TTL) |

---

## 5. ROUTING & NAVIGATION

### 5.1 Router Architecture
**Hybrid Pattern**: Uses `BrowserRouter` but with **manual route resolution**

- Routes mapped in `constants/pageRoutes.js` (20+ pages)
- Resolution: `getPageIdFromPath(location.pathname)`
- Conditional rendering in App.jsx (ternary chain, not `<Routes>`)

### 5.2 Navigation Components
| Component | Type | Purpose |
|-----------|------|---------|
| `NavigationSidebar.jsx` | Fixed Left | 21-item nav, collapsible (220px→64px) |
| `MobileHeader.jsx` | Top Bar | Hamburger with hierarchical sections |
| `MobileBottomNav.jsx` | Fixed Bottom | 5-tab + dropdown submenus |
| `LeftPanel.jsx` | Collapsible | X feed / Watchlist tabs |

### 5.3 Route Constants
```javascript
// constants/pageRoutes.js
export const PAGE_PATHS = {
  '/': 'home',
  '/research': 'research',
  '/discover': 'discover',
  '/watchlists': 'watchlists',
  '/fear-greed': 'fear-greed',
  // ... 20+ routes
};

export const getPageIdFromPath = (path) => {
  // Returns internal page ID from URL
};
```

### 5.4 Mobile Navigation Stack
```jsx
// useMobileNav() hook
const { navStack, push, pop, reset } = useMobileNav();
// Stack-based navigation for mobile flows
```

### 5.5 Auth Pattern
- Simple password gate (`AuthGate.jsx`)
- Dev bypass for localhost
- No protected route wrappers
- Handled at App level via conditional render

---

## 6. API SERVICES LAYER

### 6.1 Service Files (src/services/)

| Service | Purpose | Fallbacks |
|---------|---------|-----------|
| `codexApi.js` | Primordial token data | CoinGecko, Binance |
| `coinGeckoApi.js` | Market data | Tiered caching, 1000-coin fallback |
| `binanceApi.js` | Aggregated prices | Parallel CoinGecko + Binance |
| `stockApi.js` | Stock data | Yahoo Finance proxy, 150-stock fallback |
| `cryptoNewsApi.js` | News aggregation | CryptoPanic → CryptoCompare → RSS |
| `polymarketApi.js` | Prediction markets | Direct API, 2-min cache |
| `projectLinksApi.js` | Project discovery | Codex + CoinGecko resolver |

**Unifying Patterns Across Services:**
- **Three-tier fallback**: Primary → CORS proxy → static data
- **Symbol standardization**: Hardcoded mappings for API inconsistencies (e.g., `PEPE` → `1000PEPEUSDT`)
- **Response normalization**: Consistent internal schema across all sources
- **Client-side caching**: 30s-5min TTL based on data volatility

### 6.2 Backend Express Server (server/index.js)
**~5,200+ lines, 50+ endpoints**, organized by domain:

**Caching Strategy (Multi-tier in-memory with TTL):**
| Data Type | TTL |
|-----------|-----|
| Prices | 30 seconds |
| Token details | 15 seconds |
| Trending | 2 minutes |
| Stock data | 30s - 5min (by type) |
| Chart candles | 5 minutes |
| AI search | 5 minutes |

#### Token/Crypto Endpoints (25+)
| Endpoint | Purpose |
|----------|---------|
| `/api/tokens/search` | Token search with 30s cache |
| `/api/tokens/prices` | Batch price fetch |
| `/api/tokens/trending` | Volume-based trending |
| `/api/token/details` | Detailed token info |
| `/api/bars` | OHLCV chart data |
| `/api/coingecko/*` | Proxied CoinGecko API |

#### Stock Market Endpoints (10+)
| Endpoint | Purpose |
|----------|---------|
| `/api/stocks/quotes` | Multi-stock quotes |
| `/api/stocks/search` | Symbol search |
| `/api/stocks/candles` | OHLC chart data |
| `/api/stocks/movers` | Gainers/losers (2-min cache) |
| `/api/stocks/sectors` | Sector performance |

#### AI & Intelligence (8 endpoints)
| Endpoint | Purpose |
|----------|---------|
| `/api/ai/answer` | Monarch AI (Claude → OpenAI fallback) |
| `/api/search/whisper` | Natural language search |
| `/api/project/crawl` | Website scraping |
| `/api/project/latest-tweet` | X/Twitter integration |

### 6.3 API Key Security & Architecture Strengths

| Pattern | Implementation |
|---------|---------------|
| **CORS Bypass** | Server-side API calls only |
| **Key Security** | Keys stored in `.env`, never exposed to client |
| **Rate Limit Resilience** | Intelligent caching + fallback chain |
| **Multi-API Redundancy** | No single point of failure |
| **Deployment Flexibility** | Same `/api` paths work locally and on Vercel |

### 6.4 Data Transformation Patterns

**Number Normalization** (critical for financial data):
```javascript
// CoinGecko returns decimals (0.025), Binance returns percentages (2.5)
const changePercent = Math.abs(changeNum) <= 1 && changeNum !== 0 
  ? changeNum * 100  // Convert decimal to percentage
  : changeNum;
```

**Formatting Utilities**:
| Function | Output | Example |
|----------|--------|---------|
| `formatLargeNumber()` | Large numbers | `$1.2B`, `$3.4M`, `$95.2K` |
| `formatPrice()` | Price with precision | `$1,234.56`, `€0.0042` (8 decimals for <0.0001) |
| `formatPriceShort()` | Compact price | `$1.23K`, `$4.5M` |
| `formatLargeNumberShort()` | Mobile-optimized | `$2.34T`, `$1.5B` |

### 6.5 API Proxy Pattern
```
Development:  React → Vite Proxy (/api) → Express (:3001) → External APIs
Production:   React → Vercel Routes (/api/*) → Serverless → External APIs
```

Services auto-detect environment via `window.location.hostname`.

### 6.6 Error Handling Architecture
**Four-tier resilience:**
1. Primary API with caching (Codex, 30s cache)
2. Secondary API (CoinGecko fallback)
3. Direct CORS proxy (allorigins.win, corsproxy.io)
4. Static fallback (1000-coin mock data, 150-stock fallback data)

**Service Degradation Patterns:**
- AI services return raw context without LLM processing if APIs fail
- Stock API serves `$FALLBACK_STOCK_DATA` with randomized variations
- News services return empty arrays gracefully

### 6.7 Caching Strategy
| Data Type | TTL |
|-----------|-----|
| Prices | 30s |
| Token details | 15s |
| Trending | 2min |
| Chart candles | 5min |
| AI search | 5min |

---

## 7. AI & AGENT SYSTEMS

### 7.1 Spectre Egg System (Gamification)

**State Machine (5 stages):**
```
DORMANT → CRACKING → HATCHING → BORN → GROWING
```

**Interaction Points:**
| Action | Points |
|--------|--------|
| Daily login | 5 |
| Price prediction | 5 |
| Agent chat | 2 |
| Watchlist add | 2 |

**Thresholds:**
- 3 interactions → CRACKING
- 8 interactions → HATCHING

**Files:**
- `SpectreEgg.jsx` - Visual SVG egg with neural network
- `EggStateManager.js` - State machine + localStorage
- `EggExplainerModal.jsx` - Onboarding modal
- `useEggState.js` - React hook with cross-tab sync

### 7.2 Spectre Agent System

**6 Agent Types (assigned by 4 questions):**

| Type | Color | Specialty | Assignment |
|------|-------|-----------|------------|
| Phantom | #00f0ff | Alpha hunter | 100x + aggressive |
| Oracle | #c084fc | Sentiment reader | Informed + deep analysis |
| Cipher | #fbbf24 | Quant patterns | Portfolio + visual |
| Herald | #f87171 | News speed | Quick + 100x/informed |
| Titan | #4ade80 | Risk protection | Conservative |
| Wraith | #22d3ee | Generalist | New user default |

**Birth Questions:**
1. Motivation (100x/research/informed/portfolio)
2. Markets (majors/altcoins/memecoins/stocks/new)
3. Info Style (quick/deep/action/visual)
4. Risk Profile (conservative/moderate/aggressive/degen)

**Level Progression:**
| Level | Range | Visual |
|-------|-------|--------|
| 1 (Hatchling) | 0-50 | Basic glow |
| 2 (Developing) | 50-150 | Stronger glow |
| 3 (Mature) | 150-500 | Aura rings |
| 4 (Ascended) | 500-1500 | Particle effects |
| 5 (Apex) | 1500+ | Full aura |

**Files:**
- `SpectreAgentChat.jsx` - Chat interface
- `AgentAvatar.jsx` - SVG creature avatar
- `AgentFAB.jsx` - Floating action button
- `agentProfile.js` - Type assignment logic
- `agentResponses.js` - 100+ contextual responses

### 7.3 Monarch AI Assistant

**Features:**
- `@mentions` for token search and watchlist add
- Project intelligence (roadmap, whitepaper, socials)
- Intent-based navigation
- Deep mode toggle

**Files:**
- `AIAssistant.jsx` - Full floating assistant
- `MonarchAIChatPage.jsx` - Full-page chat

---

## 8. i18n & UTILITIES

### 8.1 i18n System
**8 Languages:** EN, AR, ES, FR, HI, PT, RU, ZH

**Implementation:**
- Lazy-loaded bundles (non-English loaded on-demand)
- **RTL support configured** (for Arabic expansion)
- ~1,500 translation keys per language
- **Namespace structure**: nav, header, welcome, research, cinema, heatmaps, bubbles, categories, fearGreed, social, roi, aiAnalysis, media, glossary, chart, token, dataTabs, errors, time, brief, xDash, gmDashboard

### 8.2 Currency System
**12 Currencies:** USD, EUR, GBP, JPY, CAD, AUD, CNY, MXN, BRL, INR, SGD, AED

**Features:**
- Live rates from CoinGecko (15-min cache)
- Smart formatting (2-8 decimals by magnitude)
- Zero-decimal for JPY/KRW

### 8.3 Constants Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `tokenColors.js` | Brand colors | `TOKEN_ROW_COLORS` (100+ tokens) |
| `majorTokens.js` | API routing | `MAJOR_SYMBOLS`, `SYMBOL_TO_COINGECKO_ID` |
| `stockData.js` | Default stocks | `TOP_STOCKS`, `STOCK_SECTORS` |
| `pageRoutes.js` | Nav mapping | `PAGE_PATHS`, `getPageIdFromPath()` |

### 8.4 Utility Functions

| File | Purpose |
|------|---------|
| `formatCurrency.js` | Price/large/short/compact formatters |
| `exchangeRates.js` | Cached rate fetching |
| `ttsNormalize.js` | Speech synthesis prep |
| `tradingViewSymbols.js` | Symbol resolution |

### 8.5 Icon System (`spectreIcons.jsx`)
- **40+ icons**, Heroicons-inspired (1.5px stroke, 24×24 viewBox)
- **Categories**:
  | Category | Examples |
  |----------|----------|
  | Navigation | star, search, trending, whale, grid, list |
  | Trading | volume, liquidation, transfer, arrow, portfolio |
  | Analysis | aiAnalysis, sector, mindshare, heatmap, news |
  | UI | chat, plus, library, image, sparkles, fire |
  | System | bank, mic, trash, globe, calendar |
- **Pattern**: Factory function `spectreIcons.iconName({ className })`

---

## 9. DEVELOPMENT WORKFLOW

### 9.1 Scripts
| Command | Purpose | Port |
|---------|---------|------|
| `npm run dev` | Vite dev server | 5180 |
| `npm run server` | Express backend | 3001 |
| `npm run dev:both` | Both servers | 5180 + 3001 |
| `npm run build` | Production build | - |
| `npm run preview` | Preview build | - |

### 9.2 Proxy Configuration
```javascript
// vite.config.js
server: {
  proxy: {
    '/api': 'http://localhost:3001',
    '/coingecko': {
      target: 'https://api.coingecko.com',
      changeOrigin: true
    }
  }
}
```

### 9.3 Dev Setup
```bash
# 1. Install dependencies
npm install
cd server && npm install

# 2. Environment
echo "CODEX_API_KEY=xxx" > .env

# 3. Start servers
npm run dev:both

# App: http://localhost:5180
# API: http://localhost:3001
```

---

## 10. DEPLOYMENT

### 10.1 Vercel Deployment

**vercel.json:**
```json
{
  "version": 2,
  "builds": [
    { "src": "package.json", "use": "@vercel/static-build" }
  ],
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

**Build Settings:**
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

**Environment:**
- Set API keys in Vercel dashboard
- Use Vercel serverless functions in `api/` directory

---

## 11. COMMON PATTERNS

### 11.1 Adding a New Page

1. **Create component:**
   ```
   src/components/MyPage.jsx
   src/components/MyPage.css
   ```

2. **Add route:**
   ```javascript
   // constants/pageRoutes.js
   '/my-page': 'my-page',
   ```

3. **Register in App.jsx:**
   ```jsx
   {page === 'my-page' && <MyPage />}
   ```

4. **Add nav item:**
   ```javascript
   // NavigationSidebar.jsx
   { id: 'my-page', icon: IconName, label: 'My Page' }
   ```

### 11.2 Adding an API Endpoint

1. **Server (development):**
   ```javascript
   // server/index.js
   app.get('/api/my-feature', async (req, res) => {
     const data = await fetchExternalAPI();
     res.json(data);
   });
   ```

2. **Client service:**
   ```javascript
   // src/services/myFeatureApi.js
   export const fetchMyFeature = async () => {
     const res = await fetch('/api/my-feature');
     return res.json();
   };
   ```

3. **Vercel function (production):**
   ```javascript
   // api/my-feature.js
   export default async function handler(req, res) {
     // Same logic as Express endpoint
   }
   ```

### 11.3 Creating a New Theme

1. **Create CSS file:**
   ```
   ComponentName.my-theme.css
   ```

2. **Add toggle logic in App.jsx**

3. **Apply class:**
   ```jsx
   <div className={`app ${theme === 'my-theme' ? 'my-theme' : ''}`}>
   ```

---

## 12. KEY DOCUMENTS REFERENCE

| Document | Purpose | Location |
|----------|---------|----------|
| `DESIGN_SYSTEM.md` | Visual system | `/` |
| `CLAUDE.md` | Agent instructions | `/` |
| `API_PLAN.md` | API architecture | `docs/` |
| `APP_STRUCTURE.md` | Component guide | `docs/` |
| `SPECTRE_TECHNICAL_DOCUMENTATION.md` | Full technical | `docs/` |
| `API_ARCHITECTURE.md` | API deep-dive | `docs/` |
| `STATE_ARCHITECTURE.md` | State patterns | `docs/` |
| `DESIGN_SYSTEM_ANALYSIS.md` | CSS patterns | `/` |
| `AI_AGENT_SYSTEM_DOCUMENTATION.md` | AI/Agent docs | `/` |

---

## 13. QUICK REFERENCE

### Color Values
- Background Void: `#000000`
- Background Base: `#0c0c0e`
- Bullish: `#10B981`
- Bearish: `#EF4444`
- Accent: `#8B5CF6`
- Success: `#22C55E`
- Error: `#EF4444`

### Breakpoints
- Mobile: `< 768px`
- Tablet: `768px - 1200px`
- Desktop: `> 1200px`

### Ports
- Frontend: `5180`
- Backend: `3001`
- Crypto Zone v2: `9876`

### Storage Keys
- Currency: `spectre-currency`
- Language: `spectre-language`
- Egg: `spectreEgg`
- Agent: `spectreAgent`

---

## 14. CONTACT & RESOURCES

- **GitHub:** https://github.com/mavismavis1124-blip/spectre-sunny
- **Local:** `~/clawd/spectre-sunny/`
- **Dev Server:** http://localhost:5180
- **API Server:** http://localhost:3001

---

*Compiled by Mavis with assistance from 8 parallel subagents*
*Total analysis time: ~5 minutes*
*Coverage: 100% of source code*
