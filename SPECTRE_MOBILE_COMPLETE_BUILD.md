# SPECTRE AI — COMPLETE MOBILE BUILD PROMPT
# The definitive Claude Code instruction for the full mobile system
# Every page. Every subpage. Every mode. Every nav layer.
# Date: March 2026

---

## ⚠️ READ THIS BEFORE WRITING A SINGLE LINE

This prompt covers 23 pages, 3 navigation layers, 4 mode states, and 2 platform targets (PWA + Capacitor).
You will not rush. You will not skip sections. You will not approximate.
Each section below is a contract. Complete it fully before moving to the next.

### Mandatory boot sequence — run in this exact order:
```
1. SPECTRE_DESIGN_LAW.md          ← Visual law. Everything is subordinate to it.
2. CLAUDE.md                      ← Architecture, routing, agent system.
3. .claude/rules.md               ← Platform Agent rules. Your responsive law.
4. MOBILE_BOOT.md                 ← Mobile extension rules (created in prior session).
5. MOBILE_PRD.md                  ← Product decisions. Navigation architecture.
6. src/index.css                  ← Token source of truth.
7. src/components/layouts/AppShell.jsx
8. src/hooks/useMediaQuery.js     ← Already exists. Use it.
9. src/store/useSettingsStore.js  ← Zustand. All persisted state lives here.
10. src/icons/spectreIcons.jsx    ← Read all 40+ icons. You will use these exclusively.
11. src/constants/pageRoutes.js   ← Every route in the app.
12. docs/APP_STRUCTURE.md         ← Every page, every component path.
```

After reading all 12 files, state: "Boot complete. X pages confirmed. Proceeding."
Only then write any code.

---

## SECTION 1 — THE THREE NAVIGATION LAYERS

Build all three layers before touching any page content.
They are the skeleton. Everything else hangs on them.

### LAYER A: Mobile Header (fixed, 52px + safe-area-top)

File: `src/components/MobileHeader.jsx` + `MobileHeader.mobile.css`

```
Layout (left → right):
[☰ Hamburger 44px] [SPECTRE wordmark centered] [₿/📈 Mode pill] [🌙/☀️ Toggle] [⌕ Search 44px]
```

Rules:
- Position: fixed top-0, full width, z-index: 200
- Background: var(--bg-base) + backdrop-filter: blur(8px)
- Border-bottom: 1px solid var(--border-subtle)
- In PWA standalone mode: padding-top = env(safe-area-inset-top, 0px)
- Hamburger (☰): opens SideDrawer, 44×44px tap target, spectreIcons
- Wordmark: "SPECTRE" in var(--font-display), letter-spacing: -0.03em
  - "AI" superscript in var(--accent), font-size: 0.6em, vertical-align: super
- Mode pill: two-state toggle [Crypto] [Stocks]
  - Active state: var(--accent) background at 0.15 opacity, var(--accent) text
  - Inactive state: transparent, var(--text-muted)
  - Reads/writes: useSettingsStore marketMode
  - Width: auto, min 80px total for both states
- Day/Night toggle: moon icon (night) / sun icon (day)
  - Reads/writes: useSettingsStore dayMode
  - Icon size: 20px, tap area: 44×44px
  - On toggle: adds/removes .app-day-mode class on document.documentElement
- Search icon: opens MobileSearchOverlay (fullscreen)
  - 44×44px tap area, spectreIcons.search

Day mode version:
```css
.app-day-mode .mobile-header {
  background: rgba(255,255,255,0.92);
  border-bottom: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 8px rgba(0,0,0,0.06);
}
```

---

### LAYER B: Bottom Tab Bar (fixed, 76px + safe-area-bottom)

File: `src/components/MobileBottomNav.jsx` + `MobileBottomNav.mobile.css`

Five tabs. This order is non-negotiable:

| Tab | Icon (spectreIcons key) | Routes to |
|-----|------------------------|-----------|
| Home | home | '/' — WelcomePage |
| Markets | trending OR chart | '/discover' context |
| Intelligence | aiAnalysis OR search | '/research-zone' |
| Watchlist | star | '/watchlists' |
| More | grid | triggers SideDrawer |

Rules:
- Position: fixed bottom-0, full width, z-index: 200
- Height: calc(76px + env(safe-area-inset-bottom, 0px))
- Background: var(--bg-elevated), glass border-top: 1px solid var(--border-default)
- Box-shadow: 0 -1px 0 var(--border-subtle), 0 -8px 24px rgba(0,0,0,0.3)
- Active tab: var(--accent) icon + label, 2px accent line ABOVE the tab (not below)
  - Indicator: `::before` pseudo, top: 0, width: 24px, centered, height: 2px, background: var(--accent)
- Inactive tab: icon + label at opacity 0.48
- Label: 10px, var(--font-body)
- Icons: spectreIcons ONLY. No Lucide. No Heroicons. Read spectreIcons.jsx first.
- More tab: does NOT navigate. Calls openDrawer() function.
- Active state managed by: current route OR useSettingsStore activeMobileTab
- Haptic on tap (if Capacitor): hapticLight()

Day mode:
```css
.app-day-mode .mobile-bottom-nav {
  background: rgba(255,255,255,0.95);
  border-top: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 -1px 0 rgba(0,0,0,0.06), 0 -4px 12px rgba(0,0,0,0.04);
}
```

---

### LAYER C: Side Drawer (slides from left)

File: `src/components/SideDrawer.jsx` + `SideDrawer.mobile.css`

Triggered by: MobileHeader hamburger OR MobileBottomNav "More" tab.

Anatomy:
```
┌────────────────────────┐▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
│ [✕] SPECTRE wordmark  │ BACKDROP rgba(0,0,0,0.6)
├────────────────────────┤ tap to close
│ [User avatar + name]   │
│ [Crypto / Stocks pill] │
├────────────────────────┤
│ — INTELLIGENCE —       │
│  ◎ Monarch AI          │
│  🔍 Search Engine      │
│  📊 AI Market Analysis │
├────────────────────────┤
│ — MARKETS —            │
│  😨 Fear & Greed       │
│  📈 Market Analytics   │
│  📅 Economic Calendar  │
│  🔬 AI Screener        │
├────────────────────────┤
│ — ANALYSIS —           │
│  📉 AI Charts          │
│  🧪 AI Charts Lab      │
│  💰 ROI Calculator     │
├────────────────────────┤
│ — VISUALIZE —          │
│  🗺 Heatmaps           │
│  🫧 Bubbles            │
│  𝕏 X Bubbles          │
├────────────────────────┤
│ — TRADING —            │
│  ⚡ Trading Lite [SOON]│
│  🏛 Trader's Corner [SOON]│
│  💧 Liquidation [SOON] │
├────────────────────────┤
│ — SOCIAL —             │
│  👥 Social Zone        │
│  𝕏 X Dash             │
├────────────────────────┤
│ — SPECTRE —            │
│  💎 Ventures           │
│  🎯 War Room           │
│  📚 Glossary           │
│  🌅 GM Dashboard       │
│  🗺 Structure Guide    │
├────────────────────────┤
│ — ACCOUNT —            │
│  🌙 Night / ☀️ Day     │ ← MODE TOGGLE (also here)
│  ₿ Crypto / 📈 Stocks  │ ← MODE TOGGLE (also here)
│  👤 Profile            │
│  ⚙️ Settings           │
└────────────────────────┘
```

Rules:
- Width: min(300px, 80vw)
- Position: fixed left-0 top-0 bottom-0, z-index: 300 (above everything)
- Transform: translateX(-100%) closed → translateX(0) open
- Animation: 280ms cubic-bezier(0.4, 0, 0.2, 1)
- Background: var(--bg-elevated)
- Right edge border: 1px solid var(--border-default)
- Right edge highlight: inset -1px 0 0 var(--border-subtle)
- Backdrop: full-screen rgba(0,0,0,0.6) behind drawer, z-index: 299
- Backdrop tap: closes drawer

Group labels:
- Font: 10px, font-weight 500, letter-spacing 0.08em, UPPERCASE
- Color: var(--text-muted)
- Padding: 16px 16px 4px

Item rows:
- Height: 48px
- Padding: 0 16px
- Icon: 20px, spectreIcons, var(--text-tertiary)
- Label: 14px, var(--font-body)
- Active item: var(--accent) icon + label, background: rgba(139,92,246,0.08)
- [SOON] items: label at 0.4 opacity, "Soon" badge: 8px text, var(--text-muted) bg pill
  - These are NOT disabled — they navigate to a "Coming Soon" state
  - Do NOT hide them. Locked items show the roadmap.

Mode toggles in drawer (bottom of Account group):
- Day/Night: same toggle as header, synced via useSettingsStore
- Crypto/Stocks: same as header, synced via useSettingsStore
- Both visible here as row items with current state shown

Day mode:
```css
.app-day-mode .side-drawer {
  background: #ffffff;
  border-right: 1px solid rgba(0,0,0,0.10);
}
.app-day-mode .side-drawer-backdrop {
  background: rgba(0,0,0,0.5);
}
```

---

## SECTION 2 — THE FOUR MODE STATES

These are not visual tweaks. They are full system states that affect every component.
Every component you write must handle all four combinations.

### MODE STATE MATRIX:

```
Night + Crypto  ← Default on first launch
Night + Stocks
Day + Crypto
Day + Stocks
```

### Night mode (default):
- No class on document root
- All CSS variables from src/index.css apply as-is
- Background: var(--bg-base) = #0c0c0e
- This is the Spectre look. Deep blacks. Glass.

### Day mode (.app-day-mode on <html>):
- Class applied by mode toggle, persisted in useSettingsStore dayMode
- Redefines CSS variables for light surfaces
- Glass cards become: white with rgba(0,0,0,0.08) borders
- backdrop-filter stays — it creates frosted glass on white too
- Accent color is SENTIMENT-DRIVEN — read from Fear & Greed index:
  - F&G > 55 (Greed): --accent → #10B981 (green)
  - F&G < 40 (Fear): --accent → #EF4444 (red)
  - F&G 40–55 (Neutral): --accent → #6366F1 (indigo)
- Implement in a useMarketSentimentAccent() hook that:
  - Reads current F&G value from store
  - Sets --accent CSS variable on document root
  - Only applies when dayMode is true
  - Falls back to #8B5CF6 if F&G data unavailable

### Crypto mode:
- useSettingsStore marketMode === 'crypto'
- Data sources: Codex + CoinGecko + Binance
- Filter categories: DeFi, AI, Meme, RWA, GameFi, Infra, Solana, Privacy, etc.
- Token rows show crypto-specific data

### Stocks mode:
- useSettingsStore marketMode === 'stocks'
- Data sources: stockApi
- Filter categories: Tech, Finance, Energy, Healthcare, Consumer, Commodities
- Token rows show stock-specific data (price, % change, P/E where available)
- Switching modes does NOT lose tab position or scroll position

### RULE: Every CSS block you write needs all 4 states covered:
```css
/* Night (default) */
.component { background: var(--bg-surface); }

/* Day */
.app-day-mode .component { background: #ffffff; }

/* Night + Stocks has no visual difference — data only */
/* Day + Stocks has no visual difference — data only */
```

---

## SECTION 3 — THE FIVE TAB SCREENS

Build in this order: 1, 2, 3, 4. Tab 5 (More) = SideDrawer only, already built in Section 1.

### TAB 1: HOME SCREEN
File: `src/pages/home/MobileHome.jsx`

Layout top to bottom:
```
[MobileHeader fixed]
[safe-area-top padding]
[AI Brief Card]
[Market Pulse Bar]
[Home Tab Switcher] ← horizontal scroll pills
[Tab Content]
[safe-area-bottom + bottom-nav padding]
[MobileBottomNav fixed]
```

**AI Brief Card** (glass, full-width, 16px margin horizontal):
- Glass: standard Spectre glass pattern, blur(8px) on mobile
- Purple radial glow behind: radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.06) 0%, transparent 70%)
- Quote text: var(--font-cinema) Playfair Display italic, 19px, centered, max 2 lines
  - NEVER truncate. Resize to 16px if needed. Never cut.
- Below quote: 4 stat pills inline (F&G value · BTC price · ETH price · SOL price)
  - All numbers: var(--font-mono)
  - F&G pill: colored by sentiment (red extreme fear → green extreme greed)
- Action row: [🎧 Listen] [Full Brief →]
  - Listen: triggers ElevenLabs TTS, becomes [⏸ Playing] with pulse animation
  - Full Brief →: navigates to Intelligence tab → Brief sub-tab
- Loading state: skeleton shimmer placeholder, same card shape. NEVER spinner.

**Market Pulse Bar** (below brief card, no card border — inline row):
- Single scrollable row: BTC.D % · Total MCap · Gas gwei · Season tag
- 11px, var(--text-tertiary), var(--font-mono) for values
- Auto-scrolls if content overflows (no scrollbar visible)
- No interaction — purely informational

**Home Tab Switcher** (the WelcomePage tabs, ported to mobile):
- Horizontal pill nav, scrollable if needed
- Tabs: [Top Coins] [On-Chain] [Prediction Markets] [AI Agents] [AI Models] [War Room]
- Reads same data sources as desktop tabs
- Active pill: var(--accent) at 0.12 opacity background + accent text, no border
- Inactive: transparent, var(--text-muted)
- Tab content renders below switcher, in the main scroll area
- Loading: skeleton shimmer per tab content type

**My Watchlist section** (visible when Top Coins tab active, below the coin list):
- Section heading: "My Watchlist", 12px uppercase, var(--text-muted)
- Compact token rows (56px) — see Section 5 for row spec
- "Add token" row at bottom: 44px, dashed border, var(--text-muted)
  - Tap: opens MobileSearchOverlay filtered to watchlist-add mode

---

### TAB 2: MARKETS SCREEN
File: `src/pages/markets/MobileMarkets.jsx`

Layout:
```
[MobileHeader fixed]
[Category Filter Bar — horizontal scroll, sticky below header]
[View Tab Pills — Top Coins / Trending / Gainers / Losers / Categories]
[Token List — virtualized]
[MobileBottomNav fixed]
```

**Category Filter Bar** (sticky, 44px height):
- Crypto mode: [All] [DeFi] [AI] [Meme] [RWA] [GameFi] [Infra] [Solana] [Privacy]
- Stocks mode: [All] [Tech] [Finance] [Energy] [Healthcare] [Consumer]
- Single select. "All" deselects others.
- Active: var(--accent) pill, white text
- Inactive: var(--bg-elevated) pill, var(--text-secondary) text
- No visible scrollbar. Smooth horizontal scroll.
- Sticky: sticks below the MobileHeader when scrolling

**View Tab Pills** (44px, below category bar):
- [Top Coins] [Trending] [Gainers] [Losers] [Categories]
- Same pill style as category bar but slightly different — these are PAGE-LEVEL tabs
- Active: var(--bg-surface) background + var(--text-primary) + 1px border var(--border-strong)

**Token List**:
- MANDATORY: react-window virtualization for all lists
- Install if not present: `npm install react-window`
- Use FixedSizeList for uniform row heights
- Row height: 64px (FULL row with rank + name + symbol + price + change + mcap + sparkline)
- See Section 5 for EXACT row spec
- Pull-to-refresh at top: native browser behavior, triggers data refetch
- Skeleton shimmer on load — 8 placeholder rows while data fetches

**Categories sub-tab** (when [Categories] tab active):
- Grid layout: 2 columns on mobile
- Each category card: 80px height, glass card, category name + token count + top performer
- Tap: filters token list to that category (don't navigate away)

---

### TAB 3: INTELLIGENCE SCREEN
File: `src/pages/intelligence/MobileIntelligence.jsx`

Layout:
```
[MobileHeader fixed]
[Sub-tab Bar — Brief / Research / News / Edition / Discover]
[Sub-tab Content]
[MobileBottomNav fixed]
```

**Sub-tab Bar** (44px, sticky):
- [Brief] [Research] [News] [Edition] [Discover]
- Horizontal scroll if needed (these are 5 tabs)
- Underline style tabs (not pills) — 2px var(--accent) underline on active
- Inactive: var(--text-muted)

**Brief sub-tab**:
- Full daily AI brief content
- Large quote block: Playfair Display italic, 22px — this is a READING experience
- Sections: Sentiment · Bias · Regime · Key Prices · Analysis
- Each section as a glass card, generous padding
- Voice player: sticky at bottom of scroll area (above bottom nav)
  - [🎧 Listen] button → mini-player appears: [⏸] [━━●━━] [timer] [✕]
  - Mini-player: 56px height, glass, no border-radius top (connects to bottom nav area)
- Date navigator: [← Yesterday] [Today] [Tomorrow →] (tomorrow disabled if no data)
- [Share] button top-right of brief card: opens native share sheet
- Loading: skeleton shimmer matching section shapes

**Research sub-tab**:
- Search bar at top, 48px height, auto-focused when sub-tab opens
- Placeholder: "Search token, wallet, or paste address..."
- Recent searches: horizontal chip row below search (max 6 chips)
- Token selected → research view slides in (push navigation feel):
  - Back arrow top-left returns to search
  - Token header: logo + full name + symbol + network badge
  - Chart: TradingChart adapted for mobile — 200px height minimum
    - Timeframe tabs: [5M] [1H] [4H] [1D] [1W] (horizontal scroll)
    - Chart type: line default on mobile (candle optional via toggle)
  - AI Summary glass card: brief analysis, 3–4 sentences
  - On-Chain section: key metrics in 2×2 grid (holders, liquidity, volume, txns)
  - News: 5 most recent items, tap → article bottom sheet
  - Social: X sentiment bar, mindshare %, top tweets (if X API available)
  - [Open in AI Screener →] CTA at bottom → full terminal (Section 6)

**News sub-tab**:
- Chronological feed, newest first
- Row: [source logo 24px] [headline] [time ago] [source tag pill]
- Row height: auto, min 60px
- Tap row: opens article in bottom sheet (MobileBottomSheet with web view or content)
- Category chips at top: [All] [BTC] [ETH] [DeFi] [NFT] [Regulation]
- Loading: skeleton shimmer (3 placeholder rows)

**Edition sub-tab** (Spectre Edition articles):
- Card grid: 1 column on mobile (full width cards)
- Card: glass, 100px height, article title + date + category tag + reading time
- Tap: opens article in bottom sheet (scrollable, full content)
- Empty state: "Intelligence is loading..." skeleton shimmer

**Discover sub-tab** (DiscoverPage ported to mobile):
- Editorial discovery layout
- Token story cards: full-width, 160px height, breathing chart background (reduced animation on mobile)
- Tap: opens TokenStorybook fullscreen (existing component)
- Section headers in Playfair Display for editorial feel
- Netflix-style horizontal rows adapted: horizontal scroll, 140px cards

---

### TAB 4: WATCHLIST SCREEN
File: `src/pages/watchlists/MobileWatchlists.jsx`

Layout:
```
[MobileHeader fixed]
[Watchlist Header Bar]
[Token List — virtualized]
[+ Add Token row — sticky bottom of list]
[MobileBottomNav fixed]
```

**Watchlist Header Bar** (48px, below MobileHeader):
- [My Lists ▾] → taps opens bottom sheet with list selector
  - Bottom sheet: lists watchlists, tap to switch active
  - [+ New List] in sheet — inline name input appears
- [Edit] toggle → right side of bar
  - Edit mode: drag handles appear left, checkboxes right, bulk delete CTA

**Token Rows**:
- Height: 56px (compact — this is the user's own data, less discovery chrome)
- Columns: [logo 36px] [Full Name + Symbol] [Price] [24h badge] [7d sparkline]
- ALL from token spec in Section 5 — full name, never truncated
- Swipe left on row: reveals [🗑 Remove] destructive action (red, var(--bear))
- Long press: activates drag reorder handle
- Tap: opens TokenBottomSheet

**+ Add Token** (sticky at bottom of list, above bottom nav):
- 48px row, dashed border-top var(--border-default)
- "+ Add to this list" text, var(--text-muted)
- Tap: opens MobileSearchOverlay in watchlist-add mode

**TokenBottomSheet** (when any token row is tapped):
- Slides up, height: 75dvh
- Drag handle at top (36×4px pill, centered, 16px from top)
- Backdrop tap or swipe down to close
- Contents:
  - Token header: [logo 48px] [Full Name large] [Symbol] [Rank badge]
  - Hero price: 32px, var(--font-mono), digit-morph on live updates
  - 24h change: large colored badge
  - Mini sparkline: full width, 100px height, 7d trend
  - 4 stat pills in 2×2 grid: Market Cap · Volume 24H · Liquidity · Circulating Supply
  - [View in AI Screener →] primary CTA — accent background
  - [Remove from Watchlist] secondary CTA — var(--text-tertiary), text only

---

## SECTION 4 — THE AI SCREENER / TERMINAL

This is the most complex mobile translation in the entire project.
The desktop AI Screener is a 3-column layout: LeftPanel + Center (chart + tabs) + RightPanel.
On mobile this cannot be 3 columns. It must be fully reimagined.

### Mobile Terminal layout:

```
[MobileHeader — but in TERMINAL MODE]
[TokenBanner — adapted for mobile]
[Chart Area — TradingChart adapted]
[Terminal Tab Bar — horizontal scroll]
[Tab Content — scrollable]
[MobileBottomNav]
```

### Terminal Mode Header modifications:
When in terminal/token view, the MobileHeader transforms:
- Hamburger → [← Back] button (returns to previous screen)
- Wordmark → token symbol + network badge (e.g. "BTC · ETH")
- Mode pill stays
- Day/Night stays
- Search stays

### TokenBanner (mobile adaptation):
- Height: 80px, no glass card — integrated into page flow
- Left: [token logo 40px] [full name, 16px bold] [symbol + rank, 12px muted]
- Right: [hero price, 24px var(--font-mono)] [24h change badge]
- Below: horizontal scroll strip — Market Cap · Volume · Liquidity · FDV · Holders
  - Each as: label (10px muted) / value (12px var(--font-mono))
  - Scrolls horizontally, 6 items visible partially
- Top-edge highlight line on this bar: 1px rgba(255,255,255,0.12)

### TradingChart (mobile adaptation):
- Height: 240px on mobile (not full viewport — user needs to scroll)
- Timeframe tabs: [5M] [1H] [4H] [1D] [1W] — horizontal scroll, 36px height
- Chart type toggle: [Line] [Candle] — icon buttons, right of timeframe tabs
- Chart renders at full width
- Zoom/pan: pinch-to-zoom on the chart area
- No crosshair on mobile — touch shows price bubble at finger position
- ATH markers: kept — they're signal-relevant
- Loading: skeleton shimmer at chart dimensions

### Terminal Tab Bar (the key navigation for the terminal):
Horizontal scrollable tabs — these map to DataTabs + LeftPanel + RightPanel content:

| Tab | Desktop origin | Mobile content |
|-----|---------------|----------------|
| Overview | RightPanel stats | Key stats, supply, FDV |
| Trades | DataTabs → Transactions | Live transaction feed |
| On-Chain | DataTabs → On-Chain | Holder data, on-chain signals |
| News | RightPanel news | CryptoPanic + RSS |
| Social | LeftPanel X feed | X posts, sentiment bar |
| AI Logs | LeftPanel AI Logs | Agent signals — Orchestrator, Backend, etc. |
| About | RightPanel about | Description, links, contract |
| Holders | DataTabs → Holders | Top holders, distribution chart |

Tab bar rules:
- 44px height, horizontal scroll, no scrollbar visible
- Underline style (2px var(--accent) line on active)
- Inactive: var(--text-muted)
- Content below each tab scrolls independently
- Tabs persist scroll position when switching (keep-alive approach per tab)

### Overview tab content (first tab, visible on load):
```
[Sentiment Gauge] ← semicircle, not full circle, 120px wide
[Bias: BEARISH / BULLISH] [Regime: label]

[Stats grid 2×3]:
Market Cap | Volume 24H
FDV        | Circulating Supply
Holders    | Liquidity

[AI Summary card] ← 3–4 sentence analysis
[Price Targets card] (if available)
```

### Trades tab content:
- Live transaction feed, newest first
- Row: [Buy/Sell badge] [amount token] [amount USD] [wallet truncated] [time ago]
- Buy: var(--bull) background at 0.12 opacity
- Sell: var(--bear) background at 0.12 opacity
- All amounts: var(--font-mono)
- Virtualized list — this can be high-frequency
- Auto-refresh every 10 seconds, new items slide in from top

### Social tab content:
- X sentiment bar: full width, red → yellow → green gradient, needle at current value
- Sentiment label: "BEARISH / NEUTRAL / BULLISH" below bar
- Mindshare %: large number, centered
- X posts: if live X API available — real posts; if not — "Live data requires X API connection"
  - DO NOT show mock tweets. Show the honest state.

### AI Logs tab content:
- Agent signal cards: Orchestrator · Backend · Blockchain · Security
- Each: glass card, agent name + role + most recent signal + timestamp
- Signal text: var(--font-body), 13px
- "Last updated: X minutes ago" at bottom
- If mock data: label each card clearly as "Simulated signal"

### Accessing the AI Screener/Terminal on mobile:
Entry points:
1. Tap any token in Markets tab → bottom sheet → [View in AI Screener →]
2. Tap any token in Watchlist → bottom sheet → [View in AI Screener →]
3. Intelligence → Research → select token → [Open in AI Screener →]
4. Side drawer → "AI Screener" item
5. Home → Watchlist row → tap → bottom sheet → [View in AI Screener →]

In all cases: pushes new screen, MobileHeader enters terminal mode with back button.
Back button returns to the exact screen the user came from.

---

## SECTION 5 — TOKEN ROW SPEC (THE LAW FOR ALL ROWS)

This section governs EVERY token row in EVERY context. There is no exception.

### The cardinal rule:
**NEVER truncate a token name. Never. Not with ellipsis, not with "B...", not ever.**
If the layout breaks, fix the layout. The name is sacred.

### Full row (Markets tab, AI Screener lists): 64px height
```
[rank 32px] [logo 36px circle] [Name        ] [Price right-aligned  ] [change badge]
                               [Symbol muted ] [Market cap right      ] [sparkline 48×28]
```
- Name: var(--font-body), 14px, var(--text-primary), font-weight 500
  - If name > 14 chars: reduce to 13px. If > 18 chars: reduce to 12px. NEVER truncate.
- Symbol: var(--font-body), 11px, var(--text-muted), below name
- Price: var(--font-mono), 14px, var(--text-primary), right-aligned
- Market cap: var(--font-mono), 11px, var(--text-tertiary), right-aligned below price
- Change badge: colored pill, 12px var(--font-mono)
  - Gain: background rgba(16,185,129,0.12) + color #10B981
  - Loss: background rgba(239,68,68,0.12) + color #EF4444
- Sparkline: 48×28px, rightmost column, colored by 7d direction
- Rank: 32px wide, var(--text-muted), 12px
- Row press state: background var(--bg-hover), transform scale(0.99), 80ms

### Compact row (Home watchlist, Watchlist tab): 56px height
```
[logo 36px] [Name        ] [Price right  ] [change badge] [sparkline 48×24]
            [Symbol muted]
```
- Same name rules — full name, never truncated
- No rank, no market cap (watchlist is the user's curated view)

### Minimal row (inside bottom sheets, search results): 48px height
```
[logo 32px] [Name · Symbol muted] [Price right] [change badge]
```
- Full name still shown. Symbol on same line, muted, after separator "·"
- No sparkline in minimal context

### Price update morphing (ALL rows):
When a live price update comes in, individual digits roll:
- Up tick: digit slides up (old digit exits top, new enters from bottom)
- Down tick: digit slides down (old exits bottom, new enters from top)
- Animation: 200ms ease-out per digit
- Stagger: each digit starts 30ms after the previous
- Color flash: green flash on up tick (100ms), red flash on down tick (100ms)
- All prices use font-variant-numeric: tabular-nums to prevent layout shift

---

## SECTION 6 — ALL 23 SUBPAGES: MOBILE TREATMENT

Every page must be handled. "It works on desktop" is not enough.
Each page needs: proper mobile layout, touch targets, day mode, loading states.

### RULE FOR ALL SUBPAGES:
Every subpage that opens from the drawer or navigation must have:
- A `MobileSubpageHeader` component at the top with:
  - [← Back] button: 44×44px, returns to previous screen
  - Page title: centered, 16px, var(--font-display)
  - Optional action button: right side, 44×44px
- Content scrolls behind this header
- Header: fixed, same glass style as MobileHeader
- Safe-area-top padding on this header

---

**PAGE 1: Fear & Greed** (`/fear-greed`)
Mobile layout:
- Hero gauge: semicircle, 200px diameter, full width centered
- Current value: 64px, var(--font-mono), centered below gauge
- Label: "EXTREME FEAR / FEAR / NEUTRAL / GREED / EXTREME GREED" 14px
- Historical chart: full width, 180px height, 30d default, timeframe tabs below
- Contributing factors: 5 glass cards stacked, each: factor name + bar + value
- Day mode: all glass cards become white + shadow

**PAGE 2: Market Analytics** (Smart Money Pulse)
Mobile layout:
- Institutional vs Retail flow bars: full width, stacked (not side-by-side)
- Dominance chart: full width, 160px
- Key metrics: 2×2 pill grid
- Flow arrows: adapted to single column

**PAGE 3: AI Market Analysis**
Mobile layout:
- Sentiment score: large centered number
- Sentiment cards: full-width stacked
- Note at bottom if LLM not connected: "Analysis based on aggregated signals"

**PAGE 4: Heatmaps**
Mobile layout:
- Heatmap grid: full width, cells scale to screen
- Pinch-to-zoom on the heatmap area
- Legend: horizontal, below map
- Category filter: pill row above map

**PAGE 5: Bubbles**
Mobile layout:
- Bubble chart: full width, preserves aspect ratio
- Tap bubble: shows token bottom sheet
- Pinch-to-zoom: enabled

**PAGE 6: X Bubbles**
Mobile layout:
- Same as Bubbles but X/social themed
- Full width, pinch-to-zoom

**PAGE 7: AI Charts**
Mobile layout:
- Chart: full width, 280px height
- AI analysis card: below chart, glass, scrollable text
- Timeframe tabs above chart

**PAGE 8: AI Charts Lab**
Mobile layout:
- "Experimental" badge in header
- Same as AI Charts layout
- Labs badge on each experimental feature

**PAGE 9: ROI Calculator**
Mobile layout:
- Single column form
- Amount input: 48px height, large keyboard-friendly
- Token selector: dropdown/bottom sheet
- Results: large typography, centered
- "If BTC returns to ATH" → result in Playfair Display for emphasis

**PAGE 10: Glossary**
Mobile layout:
- Search input at top: sticky
- Alphabetical section headers
- Term rows: 56px, term + brief definition
- Tap: expands term inline (not new page)

**PAGE 11: Discover** (editorial discovery)
Mobile layout:
- As designed in Intelligence tab Discover sub-tab
- Full-width editorial cards
- Breathing chart backgrounds: reduced/paused on mobile for performance
- Token Storybook entries: tap → fullscreen

**PAGE 12: Categories**
Mobile layout:
- 2-column grid of category cards
- Each: icon + name + top token + token count
- Tap: navigates to Markets with that category filter pre-applied

**PAGE 13: GM Dashboard**
Mobile layout:
- Full-screen overlay (same as desktop)
- Clock: 48px, var(--font-mono), centered
- Date: 16px, centered
- Greeting: "Good Morning, [name]"
- Weather: icon + temp + city, centered
- Top 5 Crypto: compact rows (48px), full names
- Top 5 Stocks: same
- News: 3 items max on mobile (not 5)
- Close: [✕] top-right 44px OR swipe down

**PAGE 14: Social Zone** (stub — honest handling)
Mobile layout:
- Page exists but data is limited
- Show "Social intelligence is coming" state — NOT a blank page
- Preview cards: what will appear here (greyed out/coming soon treatment)
- "Coming Soon" text: var(--text-muted), centered, below preview
- Do NOT show fake/mock social data as if it's real

**PAGE 15: X Dash** (stub — honest handling)
Same treatment as Social Zone.
"X intelligence dashboard — Coming Soon"
Show what it will contain as visual placeholders.

**PAGE 16: AI Media Center** (stub)
Same treatment. Preview the categories it will aggregate.

**PAGE 17: Trading Lite** (not built)
Mobile entry: accessible from drawer, shows:
- "Trading Lite" header
- Preview of what it will be: chart + order entry wireframe greyed out
- "This feature is in development" notice
- [Join Waitlist] CTA if you want it
Do NOT skip this page on mobile. It tells the story of what's coming.

**PAGE 18: Trader's Corner** (not built)
Same approach as Trading Lite.

**PAGE 19: Liquidation Heatmap** (not built)
Same approach.

**PAGE 20: Research Zone** (ResearchZoneLite)
Mobile layout:
- This is the deep research page — same data as Intelligence tab Research, but full-page
- Token selector at top (search)
- Single column layout: chart (240px) → AI summary → tabs (Overview, On-Chain, News, Social, About)
- This IS the mobile terminal light version
- Full TradingChart, full DataTabs in single column

**PAGE 21: Ventures** (Spectre AI Ventures)
Mobile layout:
- Investment thesis card at top: glass, Playfair Display quote
- Portfolio grid: 2-column
- Each project card: logo + name + sector + stage + brief description
- Tap: project detail bottom sheet

**PAGE 22: War Room**
Mobile layout:
- Two-section layout (desktop was two panels):
  - Live AI intelligence feed: full-width cards, most recent first
  - AI chat: button at bottom → opens SpectreAgentChat fullscreen
- Intelligence feed cards: 80px each, glass, timestamp + signal text

**PAGE 23: Structure Guide** (internal tool)
Mobile layout:
- Simplified — this is a developer/team reference
- Accordion sections
- Code snippets in scrollable containers
- Probably lowest mobile priority — functional > beautiful here

---

## SECTION 7 — SEARCH OVERLAY

File: `src/components/MobileSearchOverlay.jsx` + `MobileSearchOverlay.mobile.css`

Triggered by: search icon in MobileHeader.

Behavior:
- Slides down from top, covers full viewport
- Background: var(--bg-base) — NOT glass (full opacity, legibility)
- Animation: translateY(-100%) → translateY(0), 250ms ease-out
- Input: auto-focused on open, 48px height
  - Placeholder: "Search tokens, wallets, articles..."
  - Clear [✕] button appears when typing
- Keyboard pushes content up (not over)
- Close: [← Back] or swipe down or ESC

Results:
- As user types (>1 char): results appear below input
- Result groups:
  - TOKENS: TokenRowMinimal components, top 5 results
  - WALLETS: if address detected (0x... or sol address), show wallet search
  - ARTICLES: from Spectre Edition matching query, title + source
  - RECENT: chips row at top, shown before user types

Modes:
- Default mode: search everything, tap result → token bottom sheet OR article sheet
- Watchlist-add mode (from + Add button): shows [+ Add] button right of each token row
  - On tap: adds to active watchlist, shows checkmark, stays in overlay

Day mode:
```css
.app-day-mode .mobile-search-overlay {
  background: #ffffff;
}
.app-day-mode .mobile-search-overlay input {
  background: rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.10);
}
```

---

## SECTION 8 — PERFORMANCE GATES

Before any section is considered "done," it must pass these checks:

```
□ Token names: confirm ZERO truncation across all row types and viewports
□ Touch targets: all interactive elements ≥ 44×44px (use Accessibility Inspector)
□ Lists: react-window virtualization on every list > 20 items
□ Animations: all infinite animations disabled on mobile
   Exception: pulse dots (live indicators) + skeleton shimmer
□ backdrop-filter: max blur(8px) on mobile. NOT 20px.
□ Loading states: skeleton shimmer ONLY. No spinners anywhere.
□ Day mode: written for every component in same commit, never as follow-up
□ Safe area: header, bottom nav, bottom sheets all clear Dynamic Island + notch + home indicator
□ Numbers: var(--font-mono) on ALL prices, percentages, addresses. No exceptions.
□ Icons: spectreIcons ONLY. Zero external icon libraries.
□ React.memo: on TokenRowFull, TokenRowCompact — they render constantly
□ Digit morph: on all live price updates — no hard swaps
□ Press states: :active { transform: scale(0.97); opacity: 0.88; transition: 80ms }
□ No hover states on mobile — every hover-only interaction has a touch equivalent
□ Stub/not-built pages: honest state shown — never blank, never fake data
□ console.log: gated behind import.meta.env.DEV — none in production
```

---

## SECTION 9 — PWA + APP STORE

All of this was specced in SPECTRE_MOBILE_COMPLETE_PROMPT.md from prior session.
Summary of what must be confirmed before declaring mobile "done":

**PWA Checklist:**
```
□ vite-plugin-pwa installed and configured
□ manifest.json complete (all icon sizes, screenshots, shortcuts)
□ Service worker: network-first for /api/, cache-first for fonts and logos
□ apple-touch-icon.png present (180×180)
□ Splash screens for: iPhone 15 Pro Max, iPhone 15, iPhone 14 Plus, iPhone SE
□ PWAInstallPrompt component: 30s delay, iOS instruction vs Android prompt
□ Offline page: /public/offline.html (standalone, no React deps)
□ Lighthouse PWA score: 100/100
```

**Capacitor (when mobile UI is complete):**
- Do not touch Capacitor until all 23 pages are done on mobile
- capacitor.config.ts already specced in prior prompt
- AppId: io.spectreai.app

---

## SECTION 10 — BUILD ORDER AND REPORTING

### Phase 1: Navigation shell (complete this before anything else)
```
1a. MobileHeader.jsx — with all 4 icon slots, mode toggles wired to Zustand
1b. SideDrawer.jsx — all 24 destinations, grouped, with [SOON] items
1c. MobileBottomNav.jsx — 5 tabs, active state, drawer trigger
1d. MobileSearchOverlay.jsx — full version with result groups
1e. MobileSubpageHeader.jsx — reusable back-button header for all subpages
```

Report after Phase 1:
"Phase 1 complete. Header ✓, Drawer ✓ (X items), Bottom nav ✓, Search overlay ✓, Subpage header ✓"

### Phase 2: Token components (shared building blocks)
```
2a. TokenRowFull.jsx — 64px, full spec from Section 5
2b. TokenRowCompact.jsx — 56px, watchlist variant
2c. TokenRowMinimal.jsx — 48px, search/sheet variant
2d. TokenBottomSheet.jsx — 75dvh slide-up with all content
2e. DigitMorph.jsx — reusable digit-by-digit price update component
2f. SkeletonRow.jsx — reusable shimmer placeholder
```

Report: "Phase 2 complete. Token rows ✓, Bottom sheet ✓, Digit morph ✓, Skeleton ✓"

### Phase 3: Four main tab screens
```
3a. MobileHome.jsx — AI Brief + pulse bar + tab switcher
3b. MobileMarkets.jsx — category filter + view tabs + virtualized list
3c. MobileIntelligence.jsx — 5 sub-tabs
3d. MobileWatchlists.jsx — list management + gestures
```

Report per screen with touch target confirmation.

### Phase 4: AI Screener / Terminal
```
4a. MobileTerminalHeader.jsx — terminal mode header
4b. MobileTokenBanner.jsx — adapted banner
4c. MobileTerminalTabs.jsx — 8-tab terminal navigation
4d. Tab content components (TerminalOverview, TerminalTrades, etc.)
```

Report: "Terminal complete. X tabs implemented. Trades live. Social state: [honest status]."

### Phase 5: All subpages (do not rush)
Work through all 23 pages from Section 6.
For each: confirm mobile layout, touch targets, day mode, loading state.
Mark each with: DONE / PARTIAL / HONEST-STUB (not fake)

### Phase 6: Performance pass
Run through the Section 8 checklist on every component.
Fix every failure before declaring done.

### Phase 7: PWA
Run Lighthouse. Hit 100/100 PWA. Hit ≥90 Performance.

---

## FINAL LAW REMINDER

```
SPECTRE_DESIGN_LAW.md > this prompt > your own judgment
src/index.css > any color you might want to use
spectreIcons.jsx > any external icon library
useSettingsStore > localStorage direct access
MOBILE_PRD.md > any product decision not covered here
```

When in doubt: read the law. Then read it again.
The mobile app must feel like it was designed by the same hand as the desktop.
Same intelligence. Different instrument.
```
