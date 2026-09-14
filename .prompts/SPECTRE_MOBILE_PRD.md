# SPECTRE AI — MOBILE PRD
# Product Requirements Document · March 2026
# Status: Source of truth for all mobile development decisions

---

## 0. WHAT THIS DOCUMENT IS

This is the product architecture decision document for Spectre AI mobile.
Every Claude Code session building mobile features must read this before writing anything.
When this PRD conflicts with old mobile plans in docs/ — this PRD wins.
When this PRD conflicts with SPECTRE_DESIGN_LAW.md on visual matters — the law wins.

---

## 1. PRODUCT VISION

Spectre mobile is not a stripped-down version of the desktop.
It is a different instrument for the same intelligence.

Desktop = the trading floor. Three panels, high density, command center.
Mobile = the Bloomberg in your pocket. Fast reads, instant action, always-on intelligence.

A Spectre user opens the mobile app 8–12 times per day.
Six of those times they want to check something fast — price, sentiment, brief.
Two of those times they want to go deeper — research a token, read the full brief, check their watchlist.
Every once in a while they discover something they didn't know they were looking for.

The mobile app has to serve all three use cases without ever feeling cramped or slow.

**The one benchmark that matters:**
Open CMC mobile. Notice how it feels like a spreadsheet.
Open Bloomberg mobile. Notice how it feels like a terminal trapped in a phone.
Spectre mobile should feel like neither. It should feel like a tool that was designed for the phone first,
with intelligence that neither of them has.

---

## 2. USER STATES (not personas — moments)

Every mobile session begins in one of these states:

**State A — Quick Check (45 seconds)**
"What's BTC doing. What's the sentiment. Am I good."
Needs: price + 24h change + AI brief summary. One screen. No navigation.

**State B — Watchlist Sweep (2 minutes)**
"Let me check everything I'm holding."
Needs: full watchlist with live prices, change %, sparklines. Fast scroll. Tap to expand.

**State C — Token Research (5–10 minutes)**
"I want to understand this token before I do anything."
Needs: chart, AI analysis, on-chain, news, social — in a clean reading flow.

**State D — Discovery (open-ended)**
"Show me what's moving. What should I be watching."
Needs: trending, sectors, top gainers, AI-surfaced opportunities.

**State E — Deep Intelligence (10+ minutes)**
"I want the full Spectre brief. I want to read the research."
Needs: full AI Brief, Intelligence Hub, Spectre Edition articles.

The navigation architecture must make A and B instant.
C, D, E must require no more than one tap from the home screen.

---

## 3. NAVIGATION ARCHITECTURE

### 3.1 Two-layer navigation system

**Layer 1: Bottom Tab Bar (primary — always visible)**
Five tabs. These are the only things a user needs 90% of the time.

| Tab | Icon | Purpose |
|-----|------|---------|
| **Home** | home | AI Brief + market pulse + quick stats |
| **Markets** | chart-bar | Top coins, trending, sectors, discovery |
| **Intelligence** | brain/eye | Research, news, Spectre Edition, analysis |
| **Watchlist** | star | Full watchlist management |
| **More** | grid | Triggers side drawer → access to all features |

All icons from spectreIcons.jsx only. No external libraries.

**Layer 2: Side Drawer (secondary — slides in from left)**
The desktop has 21 nav items. On mobile, 16 of them live here.
Triggered by: hamburger in top-left header OR "More" tab.

```
SIDE DRAWER CONTENTS (grouped):

— INTELLIGENCE —
  Monarch AI
  Research Zone
  Search Engine
  News

— MARKETS —
  Fear & Greed
  Heatmaps
  AI Charts
  Prediction Markets
  Economic Calendar

— TRADING —
  Trading Lite
  Trader's Corner
  Liquidation Heatmap

— SOCIAL —
  Social Zone
  X Dash
  X Bubbles

— SPECTRE —
  War Room
  AI Agents
  AI Models
  Ventures

— ACCOUNT —
  Settings
  Day/Night mode toggle (also here)
  Profile
```

Drawer behavior:
- Slides in from left, width = 80% of screen max 300px
- Backdrop: rgba(0,0,0,0.6) — tap to dismiss
- Glass surface: var(--bg-elevated) with right-edge border
- Animation: translateX(-100%) → 0, 280ms expo easing
- Each group has a muted category label in var(--text-muted), 11px uppercase
- Items: 48px height, icon + label, active state in --accent

### 3.2 Mode toggles — always accessible

**Day / Night mode:**
- Toggle in: top-right header (moon/sun icon), AND side drawer bottom
- Night = default (deep blacks, glass)
- Day = white surfaces, sharp shadows, sentiment-driven accent color
  - Bullish market → green tint on accent elements
  - Bearish market → red tint
  - Neutral → indigo tint
- Toggle is instant, no page reload, CSS class swap on .app root

**Market mode (Crypto / Stocks):**
- Toggle in: header, next to search
- Two pill states: [Crypto] [Stocks]
- Swapping mode changes: top coins data source, screener, relevant watchlist

No other toggles live in the header. Header stays clean.

### 3.3 Header anatomy (52px + safe area top)

```
[≡ Hamburger]  [Spectre wordmark]  [Crypto|Stocks]  [🌙 Mode]  [🔍 Search]
```

- Hamburger: 44×44px, opens side drawer
- Wordmark: centered or left-of-center depending on screen width
- Crypto/Stocks toggle: small pill, 2 states only
- Mode toggle: moon/sun icon, 44×44px
- Search: magnifier icon, 44×44px — opens full-screen search overlay

Header is fixed. Content scrolls behind it. Header background: var(--bg-base) with blur(8px).
In PWA/standalone mode: extra safe-area-inset-top padding for status bar.

---

## 4. THE FIVE SCREENS

### SCREEN 1: HOME TAB

**Job:** Serve State A (quick check) and State B (watchlist sweep) instantly.

**Layout (top to bottom):**

```
┌─────────────────────────────────────┐
│ HEADER                              │
├─────────────────────────────────────┤
│                                     │
│  AI BRIEF CARD (glass, full width)  │
│  ─────────────────────────────────  │
│  "Extreme fear. BTC steady.         │
│   Waiting for a catalyst."          │
│                                     │
│  [F&G: 16 Extreme Fear]             │
│  [BTC: $70,473 ▼1.2%]              │
│  [ETH: $2,074 ▼1.06%]              │
│  [SOL: $87 ▼1.7%]                  │
│                                     │
│  [🎧 Listen]  [Full Brief →]        │
│                                     │
├─────────────────────────────────────┤
│ MARKET PULSE BAR                    │
│ BTC.D 56.8% · MCap $2.49T · Gas 12 │
├─────────────────────────────────────┤
│                                     │
│  MY WATCHLIST                       │
│  ─────────────────────────────────  │
│  [BTC]  $70,473  ▼1.20%  [sparkline]│
│  [ETH]  $2,074   ▼1.06%  [sparkline]│
│  [SOL]  $87.14   ▼1.70%  [sparkline]│
│  [ARB]  $0.1006  ▼3.18%  [sparkline]│
│  ─────────────────────────────────  │
│  + Add token                        │
│                                     │
├─────────────────────────────────────┤
│ BOTTOM NAV                          │
└─────────────────────────────────────┘
```

**AI Brief card rules:**
- Glass card: standard Spectre glass pattern (reduced blur 8px on mobile)
- Quote text: var(--font-cinema) Playfair Display italic — this is the ONE editorial moment
- Quote size: 18px on mobile, single quote, max 2 lines
- Below quote: 3–4 key stats as small pills (F&G, BTC price, ETH, SOL)
- Stats use var(--font-mono) for numbers — always
- [Listen] button: triggers ElevenLabs voice brief
- [Full Brief →] navigates to full brief in Intelligence tab
- Card has a faint purple radial gradient behind it at rgba(139,92,246,0.04)

**Market pulse bar rules:**
- 1 line, scrolls horizontally if content overflows
- BTC.D · Total MCap · Gas · BTC Season / Alt Season
- Small text 11px, var(--text-tertiary), var(--font-mono) for numbers
- No interaction — read-only

**Watchlist rules:**
- Full token name shown — NEVER truncated (this is the critical fix from current mobile)
- Row height: 56px minimum
- Columns: [logo 36px] [name full + symbol muted] [price] [24h change badge] [7d sparkline]
- Sparkline: 48px wide, inline, green/red based on direction
- Change badge: colored background at 0.15 opacity, matching text
  - Green: rgba(16,185,129,0.15) + #10B981 text
  - Red: rgba(239,68,68,0.15) + #EF4444 text
- Price: var(--font-mono), full precision (never rounded to 2 decimal if token is <$1)
- Tap row: opens token bottom sheet (not new page)
- Swipe left on row: reveals [Remove from watchlist] action
- Empty state: "Your watchlist is empty. Tap Markets to start tracking."

**Token bottom sheet (from watchlist tap):**
Slides up, height 75dvh. Contains:
- Token header: logo + name + symbol + rank
- Hero price: large, var(--font-mono), digit-morph on live update
- 24h change + sparkline chart (full width, 120px tall)
- 4 stat pills: Market Cap · Volume 24H · Dominance · Liquidity
- [View Full Research →] CTA — navigates to Research Zone for this token
- [Add to Watchlist / Remove] secondary action

---

### SCREEN 2: MARKETS TAB

**Job:** Serve State D (discovery). Show what's moving. Surface the signal.

**Layout:**

```
┌─────────────────────────────────────┐
│ HEADER                              │
├─────────────────────────────────────┤
│ FILTER BAR (horizontal scroll)      │
│ [All] [DeFi] [AI] [Meme] [RWA]     │
│ [GameFi] [Infra] [Solana] [Privacy] │
├─────────────────────────────────────┤
│ VIEW TABS                           │
│ [Top Coins] [Trending] [Gainers]   │
│ [Losers] [New Listings]            │
├─────────────────────────────────────┤
│                                     │
│  TOKEN LIST                         │
│  ─────────────────────────────────  │
│  1  [BTC]  Bitcoin      $70,702     │
│            ▼0.79% 24H  ▼13.70% 1Y  │
│            $1.41T mcap  [sparkline] │
│  ─────────────────────────────────  │
│  2  [ETH]  Ethereum     $2,081      │
│            ▼0.68% 24H  +10.04% 1Y  │
│            $251.57B    [sparkline]  │
│                                     │
│  (infinite scroll, virtualized)     │
│                                     │
├─────────────────────────────────────┤
│ BOTTOM NAV                          │
└─────────────────────────────────────┘
```

**Token list row rules:**
- Rank number: left, var(--text-muted), 32px wide
- Logo: 36px circle, lazy loaded
- Name: FULL name (not truncated), var(--text-primary), var(--font-body)
- Symbol: below name, var(--text-muted), 12px
- Price: right-aligned, var(--font-mono), var(--text-primary)
- 24h change: pill badge (colored)
- 1Y change: secondary badge, smaller
- Market cap: below price, var(--text-tertiary), var(--font-mono)
- Sparkline: far right, 48×28px, colored by direction
- Row height: 64px (two-line layout needs more space than 56px)
- Tap: token bottom sheet (same as watchlist tap)
- Favorite icon: heart/star, top-right of row, 44×44px tap area

**View tabs:** horizontal pill tabs, not underline tabs.
Active: --accent background at 0.15 opacity + accent text.
Inactive: transparent + var(--text-muted).

**Filter bar:** horizontal scroll, no scrollbar visible.
One-touch category filter. "All" resets.
Syncs with market mode (Crypto shows crypto categories, Stocks shows sector filters).

---

### SCREEN 3: INTELLIGENCE TAB

**Job:** Serve State E (deep intelligence) and State C (token research).

**Layout:**

```
┌─────────────────────────────────────┐
│ HEADER                              │
├─────────────────────────────────────┤
│ SUB-TABS (horizontal scroll)        │
│ [Brief] [Research] [News] [Edition] │
├─────────────────────────────────────┤

--- BRIEF SUB-TAB ---
│ Today's AI Brief (full text)        │
│ Playfair Display for quote          │
│ Analysis sections as cards          │
│ Voice playback strip at bottom      │

--- RESEARCH SUB-TAB ---
│ Search bar (token search)           │
│ [Recent: BTC, ETH, SOL...]         │
│ Research sections load on token     │
│ select: chart + AI summary + on-    │
│ chain + news + social in scroll     │

--- NEWS SUB-TAB ---
│ Chronological feed                  │
│ Source tag + headline + time        │
│ Tap: opens article in bottom sheet  │

--- EDITION SUB-TAB ---
│ Spectre Edition articles            │
│ Card grid: title + date + tag       │
│ Tap: full article in bottom sheet   │

├─────────────────────────────────────┤
│ BOTTOM NAV                          │
└─────────────────────────────────────┘
```

**Brief sub-tab rules:**
- Opens to today's brief automatically
- Quote section: Playfair Display, 22px, centered, full width
- Sentiment badges: same pill pattern as desktop
- Sections: Fear & Greed · Bias · Regime · Key prices
- [🎧 Listen to Brief] sticky at bottom of brief card
- Share button: top right of brief card
- Date navigator: left/right arrows to see previous days

**Research sub-tab rules:**
- Token search at top (auto-focused when tab opens)
- Recent searches as horizontal chips below search
- After token selected: full scrollable research view
  - Chart: 180px height, timeframe tabs (24h, 7d, 30d, 1Y)
  - AI Summary: glass card with brief analysis
  - On-Chain signals: key metrics
  - News: last 5 relevant news items
  - Social: X sentiment, mindshare %
- Back arrow returns to token search

---

### SCREEN 4: WATCHLIST TAB

**Job:** Serve State B fully. Full watchlist management.

**Layout:**

```
┌─────────────────────────────────────┐
│ HEADER                              │
├─────────────────────────────────────┤
│ [My Lists v]  [+ New List]  [Edit]  │
├─────────────────────────────────────┤
│                                     │
│  LIST: Main Portfolio               │
│  ─────────────────────────────────  │
│  Total value if connected: $X       │
│  (or "Connect wallet to track P&L") │
│  ─────────────────────────────────  │
│                                     │
│  BTC   Bitcoin      $70,702  ▼1.2%  │
│        [sparkline 7d]               │
│  ETH   Ethereum     $2,081   ▼1.06% │
│        [sparkline 7d]               │
│  SOL   Solana       $87.14   ▼1.7%  │
│                                     │
│  (virtualized, swipe to remove)     │
│                                     │
│  + Add to this list                 │
│                                     │
├─────────────────────────────────────┤
│ BOTTOM NAV                          │
└─────────────────────────────────────┘
```

**Watchlist selector:**
"[My Lists v]" opens a bottom sheet with all watchlists.
User taps to switch active list.
[+ New List] creates a new list (inline name input).

**Token rows:** same pattern as Home tab watchlist.
Full name always. var(--font-mono) for prices. Sparkline always visible.
Swipe left: [Remove] in red (var(--bear)).
Long press: drag to reorder (haptic on native, cursor on web).

**Edit mode:**
Toggle [Edit] in header → reorder handles appear left of each row.
Checkbox appears right — select multiple for bulk remove.
[Done] exits edit mode.

---

### SCREEN 5: MORE (SIDE DRAWER TRIGGER)

Tapping the More tab triggers the side drawer (same as hamburger).
The More tab itself does not have its own screen.
This keeps the bottom nav clean — 4 primary destinations + 1 access point for everything else.

The side drawer IS Screen 5.

---

## 5. MODE SYSTEM

### 5.1 Night Mode (default)

The Spectre look. Deep blacks, glass cards, purple accent.
All tokens from SPECTRE_DESIGN_LAW.md apply without modification.
This is what users see on first launch.

```css
/* Night mode = default, no class needed */
--bg-base: #0c0c0e;
--bg-surface: #131316;
--text-primary: rgba(255,255,255,1);
--accent: #8B5CF6;
```

### 5.2 Day Mode

Not just inverted. A different emotional register — the Apple Store version.

```css
.app.app-day-mode {
  --bg-void: #f0f0f2;
  --bg-base: #ffffff;
  --bg-surface: #f8f8fa;
  --bg-elevated: #f0f0f4;
  --bg-hover: #e8e8f0;
  --text-primary: rgba(0,0,0,0.92);
  --text-secondary: rgba(0,0,0,0.65);
  --text-tertiary: rgba(0,0,0,0.40);
  --text-muted: rgba(0,0,0,0.25);
  --border-subtle: rgba(0,0,0,0.04);
  --border-default: rgba(0,0,0,0.08);
  --border-strong: rgba(0,0,0,0.14);
}
```

Day mode accent is SENTIMENT-DRIVEN (read from market data):
- Bullish (F&G > 55): accent → #10B981 (green)
- Bearish (F&G < 40): accent → #EF4444 (red)
- Neutral (40–55): accent → #6366F1 (indigo)

Day mode glass cards:
```css
.app.app-day-mode .glass-card {
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
}
```

Mode persists in useSettingsStore (Zustand). Never use raw localStorage for this.

### 5.3 Market Mode (Crypto / Stocks)

Two-state pill toggle in the header.

**Crypto mode:**
- Top coins = crypto (Codex + CoinGecko)
- Filter categories = DeFi, AI, Meme, RWA, GameFi, Infra, Solana, Privacy, etc.
- Watchlist shows crypto tokens

**Stocks mode:**
- Top coins = stocks (stockApi)
- Filter categories = Tech, Finance, Energy, Healthcare, Consumer, etc.
- Shows: stock price, % change, volume, market cap
- Integrates tokenized stocks analysis where available
- Watchlist shows stocks

Mode persists in useSettingsStore.
Switching mode does NOT lose the user's place — same tab, same scroll position, new data.

---

## 6. INFORMATION HIERARCHY PER TOKEN ROW

This is the most important section in this document for mobile.
Token rows on mobile have failed in the current build because names are truncated.
This is the definitive spec for every token row in every context.

### Full row (Markets tab, 64px):

```
[rank] [logo] [Name        ] [price     ] [24h badge]
       [      ] [symbol muted] [mcap      ] [sparkline ]
```

Rules:
- Name: full, never truncated, var(--font-body), var(--text-primary)
- Symbol: below name, var(--text-muted), 12px
- Price: var(--font-mono), var(--text-primary), right-aligned
- 24h badge: colored pill
- Market cap: var(--font-mono), var(--text-tertiary), right-aligned below price
- Sparkline: 48×28px, rightmost column

If the name is very long (> 14 chars), reduce font size to 13px. Never truncate.

### Compact row (Home watchlist, 56px):

```
[logo] [Name        ] [price  ] [24h badge] [sparkline]
       [symbol muted]
```

Same rules, no rank, no mcap in compact view.

### Minimum viable row (inside bottom sheets or small contexts):

```
[logo] [Name  Symbol] [price] [change]
```

Even here: full name. If it doesn't fit, the layout is wrong — fix the layout.

---

## 7. INTERACTION PATTERNS

### 7.1 Token tap → bottom sheet (not page navigation)

Every token tap anywhere in the app opens a bottom sheet first.
The bottom sheet has [View Full Research →] to go deeper.
This keeps the user's context (their scroll position, their tab) intact.

Sheet opens in 280ms, slides up from bottom.
Sheet closes: tap backdrop, swipe down, or [✕] in top-right.

### 7.2 Search

Triggered by search icon in header (44×44px tap area).
Opens full-screen overlay — covers entire viewport.
Background: var(--bg-base), NOT glass (full opacity for legibility).
Input auto-focuses. Keyboard opens.
Results appear as user types.
Results show: tokens matching name or symbol, wallets (if paste address), recent searches.
[✕] or swipe down closes overlay.

### 7.3 Press states (replaces hover on mobile)

All interactive elements:
```css
:active {
  transform: scale(0.97);
  opacity: 0.88;
  transition: all 80ms ease;
}
```

On native (Capacitor): accompany with hapticLight() on significant actions,
hapticSuccess() on add to watchlist, watchlist creation.

### 7.4 Pull to refresh

Available on: Home tab, Markets tab, Watchlist tab.
Uses native browser pull-to-refresh behavior.
On release: trigger data refresh on all visible data sources.
Loading state: skeleton shimmer on content (never spinner).

### 7.5 Number morphing on live price update

When a price updates in the watchlist or home screen, digits change individually.
Not a hard swap. Not a fade. Digit-by-digit roll.

```css
@keyframes digit-up {
  from { transform: translateY(100%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes digit-down {
  from { transform: translateY(-100%); opacity: 0; }
  to   { transform: translateY(0);     opacity: 1; }
}
```

Each digit wraps in a container with overflow: hidden.
Price increase → digits roll up. Price decrease → digits roll down.

### 7.6 Skeleton shimmer

All loading states use skeleton shimmer — no exceptions, no spinners.
```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-surface) 25%,
    var(--bg-elevated) 50%,
    var(--bg-surface) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
```

---

## 8. COMPONENT INVENTORY

Build these in order. Each must be complete before the next begins.

| Priority | Component | File | Depends on |
|----------|-----------|------|------------|
| 1 | MobileHeader | src/components/MobileHeader.jsx | spectreIcons, useSettingsStore |
| 2 | SideDrawer | src/components/SideDrawer.jsx | MobileHeader |
| 3 | MobileBottomNav | src/components/MobileBottomNav.jsx | spectreIcons |
| 4 | TokenRowFull | src/components/mobile/TokenRowFull.jsx | nothing |
| 5 | TokenRowCompact | src/components/mobile/TokenRowCompact.jsx | nothing |
| 6 | TokenBottomSheet | src/components/mobile/TokenBottomSheet.jsx | TokenRowFull |
| 7 | MobileSearchOverlay | src/components/MobileSearchOverlay.jsx | TokenRowCompact |
| 8 | HomeTab | src/pages/home/MobileHomeTab.jsx | all above |
| 9 | MarketsTab | src/pages/markets/MobileMarketsTab.jsx | TokenRowFull |
| 10 | IntelligenceTab | src/pages/intelligence/MobileIntelligenceTab.jsx | – |
| 11 | WatchlistTab | src/pages/watchlist/MobileWatchlistTab.jsx | TokenRowCompact |

---

## 9. MODE TOGGLE PLACEMENT MAP

Where every toggle lives (definitive):

| Toggle | Primary location | Secondary location |
|--------|------------------|--------------------|
| Day/Night | Header — moon/sun icon | Side drawer — bottom |
| Crypto/Stocks | Header — pill next to search | Side drawer — top section |
| Search | Header — magnifier icon | Home tab — search row |
| Side drawer | Header — hamburger left | More tab in bottom nav |

Nothing else lives in the header. The header is sacred. Four icons max.

---

## 10. DAY MODE IMPLEMENTATION RULE

Every component, without exception, must include day mode styles.
Pattern:

```css
/* Component default (night) */
.component-name {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

/* Day mode — always directly below the default */
.app.app-day-mode .component-name {
  background: #ffffff;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
```

The day mode style must be written at the same time as the default style.
Not as a follow-up. Not later. Same commit.

---

## 11. PERFORMANCE REQUIREMENTS

Mobile must hit these before any App Store submission:

| Metric | Target |
|--------|--------|
| Lighthouse PWA | 100 |
| Lighthouse Performance (mobile) | ≥ 90 |
| First Contentful Paint | < 1.5s |
| Time to Interactive | < 3.0s |
| Largest Contentful Paint | < 2.5s |
| Cumulative Layout Shift | < 0.10 |

To hit these:
- Lists > 20 items: react-window virtualization (install: `npm install react-window`)
- React.memo() on TokenRowFull and TokenRowCompact — they render many times
- No inline style objects inside render functions
- backdrop-filter: blur(8px) max — not 20px
- All images: loading="lazy" decoding="async"
- contain: layout style paint on token rows
- Kill all infinite animations on mobile except: pulse dots, skeleton shimmer

---

## 12. WHAT THIS PRD EXPLICITLY DEFERS

These are NOT in scope for the initial mobile build.
Do not design for these. Do not leave placeholder slots.
Build them when the core 5 screens are perfect.

- Push notifications
- Biometric authentication
- Wallet connection / P&L tracking
- Live price ticker in iOS Dynamic Island
- Widget (iOS home screen widget)
- iPad-specific layout
- Landscape mode (portrait only for v1)
- Offline mode beyond PWA service worker cache
- In-app purchases or paywall

---

## 13. OPEN QUESTIONS (answers needed before build)

1. **Tab icons:** Which spectreIcons map to Home / Markets / Intelligence / Watchlist / More?
   → Sunny to confirm from spectreIcons.jsx

2. **AI Brief on home:** Show today's brief always, or only if user has seen it?
   → Recommendation: always show, collapsed if seen, expanded if new

3. **Stocks in Markets tab:** Show alongside crypto in same list, or mode-switch only?
   → Recommendation: mode-switch only. Keep Crypto and Stocks cleanly separated.

4. **Token bottom sheet chart:** Live candle data or simplified sparkline?
   → Recommendation: sparkline with timeframe tabs (no full TradingChart on mobile)

5. **Voice brief on Home:** ElevenLabs plays inline or opens Intelligence tab?
   → Recommendation: plays inline in a sticky mini-player bar above bottom nav

---

## REVISION HISTORY

| Date | Change | Author |
|------|--------|--------|
| 2026-03-14 | Initial PRD created | Claude (with Sunny) |
