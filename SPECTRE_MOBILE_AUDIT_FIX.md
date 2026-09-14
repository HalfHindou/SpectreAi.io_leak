# SPECTRE MOBILE — AUDIT & SURGICAL FIX PROMPT
# You built AI slop. This prompt tears it down and rebuilds it correctly.
# Every fix references the EXACT existing file, class, or component.

---

## MANDATORY: READ THESE FILES FIRST — IN ORDER — BEFORE TOUCHING ANYTHING

```
1. SPECTRE_DESIGN_LAW.md
2. src/index.css                          ← CSS variables. The only source of truth.
3. src/components/WelcomePage.jsx         ← The desktop reference. Study it.
4. src/components/WelcomePage.css         ← 17,000+ lines. The mobile rules are in here.
5. src/components/Header.jsx              ← Desktop header. Mobile version must match.
6. src/components/Header.css             
7. src/components/layouts/AppShell.jsx   ← Shell. Understand before touching.
8. src/components/MobileHeader.jsx        ← EXISTS. Extend it, don't replace it.
9. src/components/MobileBottomNav.jsx     ← EXISTS. Extend it, don't replace it.
10. src/hooks/useMediaQuery.js            ← useIsMobile() hook. Already works.
11. src/store/useSettingsStore.js         ← Zustand store. All state lives here.
12. src/icons/spectreIcons.jsx            ← Read every icon. Use ONLY these.
13. docs/MOBILE_LANDING_STRUCTURE_PLAN.md ← The exact mobile architecture already planned.
14. docs/MOBILE_AGENT_PLAN.md            ← Mobile checklist already written.
```

After reading all 14 files, state what you found in each one before writing any code.
If you did not read a file, you are not permitted to edit any file that depends on it.

---

## THE AUDIT: 9 SPECIFIC FAILURES TO FIX

Fix them in this order. Do not skip ahead. Report completion of each before starting the next.

---

### FIX 1: THE DESIGN IS AI SLOP — NOT SPECTRE

**The problem:**
You generated generic dark UI with made-up colors, generic card styles, and your own layout decisions.
The Spectre glass system already exists. You ignored it.

**The law:**
The desktop WelcomePage welcome widget uses this exact glass:
```css
background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
border: 1px solid rgba(255, 255, 255, 0.2);
border-radius: 24px;
box-shadow:
  inset 0 0 0 1px rgba(255,255,255,0.12),
  inset 0 1px 0 rgba(255,255,255,0.18),
  inset 0 -1px 0 rgba(255,255,255,0.06),
  inset 0 0 24px -8px rgba(255,255,255,0.06),
  0 4px 12px rgba(0,0,0,0.4),
  0 8px 24px rgba(0,0,0,0.3);
```

Every card on mobile uses this exact glass. Not a simplified version. Not a substitute.
The mobile blur is reduced to blur(8px) but the rest is identical.

**What to do:**
1. Open WelcomePage.css. Find .welcome-widget-glass and every card class using this pattern.
2. Copy these exact values into your mobile CSS. Do not approximate.
3. Audit every card you created. If it does not match — delete it and use the correct glass.
4. Background of the app: var(--bg-base) = #0c0c0e. Not #000. Not #111. Exactly #0c0c0e.
5. All text colors must use var(--text-primary), var(--text-secondary), var(--text-tertiary), var(--text-muted).
   No hardcoded rgba values for text. The variables handle this.
6. Purple accent: var(--accent) = #8B5CF6. Used ONLY on active states and primary CTAs.
7. All prices, numbers, percentages, addresses: font-family: var(--font-mono). No exceptions.

---

### FIX 2: HEADER IS WRONG OR MISSING

**The problem:**
The desktop Header.jsx has: weather + datetime left, logo center, trending strip below, market ticker strip, search, profile, day/night, Crypto/Stocks toggle.
The mobile version must preserve the Spectre look while being touch-friendly.

**What the mobile header MUST have (left to right):**
```
[hamburger — opens nav drawer, 44px]  [SPECTRE wordmark]  [Crypto/Stocks pill]  [day/night]  [search]
```

Below that — a compact ticker strip (one line, scrollable):
```
BTC $70,473 ▼1.2%  ·  ETH $2,074 ▼1.06%  ·  SOL $87 ▼1.7%  ·  F&G: 16  ·  MCap $2.49T
```

**What to do:**
1. Open src/components/MobileHeader.jsx. This file exists. Read it fully.
2. Open Header.jsx and Header.css. See what desktop renders.
3. In MobileHeader, implement the 5-item header row above.
4. Add a MobileTickerStrip below the header row:
   - Single scrollable row, 36px height
   - Font: 11px, var(--font-mono) for all values, var(--text-tertiary)
   - Data: BTC price, ETH price, SOL price, F&G value, total MCap
   - Auto-scrolls if overflow. No scrollbar visible.
   - Use existing price data from useCodexData or the store — do NOT fetch new data.
5. Header total height: 52px (header row) + 36px (ticker strip) = 88px + safe-area-top
6. All content below must have padding-top: calc(88px + env(safe-area-inset-top, 0px))
7. Background: var(--bg-base) + backdrop-filter: blur(8px)
8. Border-bottom: 1px solid var(--border-subtle)

Day mode:
```css
.app-day-mode .mobile-header {
  background: rgba(255,255,255,0.92);
  border-bottom: 1px solid rgba(0,0,0,0.08);
}
```

---

### FIX 3: WELCOME WIDGET IS MISSING FROM HOME

**The problem:**
The desktop WelcomePage.jsx renders the full welcome widget (profile, F&G gauge, market stats, AI brief quote, etc.).
On mobile the welcome widget must appear first — it IS the home screen content.

**The exact mobile layout of the landing page (one scrollable column):**
```
1. Welcome Widget    id="welcome" on .welcome-panel-wrap
2. Command Center    id="command-center" on .welcome-market-ai-widget
3. Watchlist         id="watchlist" on .welcome-watchlist-panel-wrap
4. Top Coins         id="top-coins" on discovery section
```

**What to do:**
1. Open WelcomePage.jsx. Find the .welcome-sidebar-row element.
   On desktop: it is a horizontal row of three panels.
   On mobile (<768px): it must stack vertically.

2. In WelcomePage.css, find or add this mobile override:
```css
@media (max-width: 768px) {
  .welcome-sidebar-row {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .welcome-panel-wrap,
  .welcome-market-ai-widget,
  .welcome-watchlist-panel-wrap {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    min-height: auto !important;
  }

  .welcome-panel-wrap { order: 1; }
  .welcome-market-ai-widget { order: 2; }
  .welcome-watchlist-panel-wrap { order: 3; }
}
```

3. Add scroll margin so fixed header does not obscure section targets:
```css
@media (max-width: 768px) {
  #command-center,
  #watchlist,
  #top-coins {
    scroll-margin-top: 96px;
  }
}
```

4. The welcome widget AI Brief quote must use var(--font-cinema) Playfair Display italic.
   Check WelcomePage.jsx for where the brief quote renders. Ensure this class is applied on mobile.

5. Welcome widget glass must match desktop EXACTLY. Not simplified.
   If it renders as a white box or flat card — it is wrong. Apply the glass from Fix 1.

---

### FIX 4: COMMAND CENTER IS INCOMPLETE

**The problem:**
The Command Center (.welcome-market-ai-widget) on desktop has multiple tabs:
AI Brief, AI Market, News, Heatmaps, Liquidation, Sectors, Mindshare, Calendar, Flows, Wallets.
On mobile ALL of these tabs must exist and work.

**What to do:**
1. Open WelcomePage.jsx. Find the Command Center section.
2. Find the tab system that renders AI Brief, News, Heatmaps, etc.
3. On mobile, these tabs must:
   - Scroll horizontally if they do not fit (no wrap, no truncation)
   - Tab height: 40px minimum, 44px touch target
   - Active tab: var(--accent) color + underline or pill background
   - Tab content renders below, in the main scroll flow

4. Each tab content panel: remove overflow: hidden and max-height if it is preventing scroll.
   Replace with overflow-y: auto or let it flow naturally.

In WelcomePage.css, find the real class names for the Command Center tab bar and add:
```css
@media (max-width: 768px) {
  /* Replace [real-tab-bar-class] with the actual class from WelcomePage.jsx */
  [real-tab-bar-class] {
    overflow-x: auto;
    overflow-y: visible;
    white-space: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  /* Replace [real-tab-content-class] with the actual class from WelcomePage.jsx */
  [real-tab-content-class] {
    overflow: visible !important;
    max-height: none !important;
    height: auto !important;
  }
}
```

NOTE: You must inspect the actual class names used in WelcomePage.jsx for the Command Center.
Do not guess. Read the file.

---

### FIX 5: TOP COINS TABLE IS MISSING OR BROKEN

**The problem:**
The Top Coins section is either missing from mobile or the content is unscrollable.

**What to do:**
1. In WelcomePage.jsx, find the discovery section (Top Coins table with rank, name, price, 24h, 1Y, mcap).
2. On mobile this table needs:
   - Horizontal scroll container (overflow-x: auto) for the table
   - Reduced column set using isMobile: show # · Name · Price · 24h · MCap only
   - Hide: 1Y column, volume column on mobile
   - Token names: FULL NAME visible. Never truncated with ellipsis or "B..."
   - Use formatPriceShort and formatLargeNumberShort (already in codexApi.js) for compact values

```css
@media (max-width: 768px) {
  /* Replace with real class names from WelcomePage.jsx */
  [top-coins-table-wrapper] {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* Hide less critical columns on mobile */
  [top-coins-col-1y],
  [top-coins-col-volume] {
    display: none;
  }

  /* Token names: full, never truncated */
  [top-coins-name-cell] {
    white-space: nowrap;
    overflow: visible;
    text-overflow: unset;
    min-width: 120px;
  }
}
```

3. Find the real class names in WelcomePage.jsx for the Top Coins table and substitute above.
4. Verify isMobile is passed to the component and compact formatters are applied when true.

---

### FIX 6: SCROLL IS BROKEN ON MULTIPLE ELEMENTS

**The problem:**
Multiple panels have overflow: hidden or fixed heights preventing scroll.
Content exists but users cannot reach it.

**Systematic fix:**

Step 1: Find every overflow: hidden in WelcomePage.css and Header.css.
For each one: was it for desktop layout control?
If yes: add a mobile override that removes it.

Step 2: The main scroll container is .welcome-page. Verify it is set up correctly:
```css
@media (max-width: 768px) {
  .welcome-page {
    overflow-y: auto !important;
    overflow-x: hidden !important;
    -webkit-overflow-scrolling: touch;
    height: 100dvh !important;
    padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px)) !important;
  }
}
```

Step 3: Remove height constraints that trap content:
```css
@media (max-width: 768px) {
  .welcome-panel-wrap,
  .welcome-market-ai-widget,
  .welcome-watchlist-panel-wrap,
  [class*="welcome-widget"],
  [class*="welcome-card"] {
    max-height: none !important;
    height: auto !important;
    overflow: visible !important;
  }
}
```

Step 4: Main content area must have padding-bottom to clear the fixed bottom nav:
```css
@media (max-width: 768px) {
  .welcome-page {
    padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  }
}
```

Step 5: Command Center tab content panels — remove any max-height or overflow: hidden.
The tab content should flow to its natural height. The .welcome-page scroll handles the rest.

---

### FIX 7: BOTTOM NAV PLACEMENT AND BEHAVIOR

**The problem:**
Desktop NavigationSidebar appearing on mobile alongside bottom nav.
Wrong position. Wrong items.

**What to do:**
1. Open AppShell.jsx or App.jsx. Find where NavigationSidebar renders.
   It must be wrapped in a desktop-only conditional:
```jsx
const isMobile = useIsMobile();
// ...
{!isMobile && <NavigationSidebar ... />}
```
If NavigationSidebar shows on mobile — this conditional is missing. Add it.

2. Open MobileBottomNav.jsx. Verify its CSS:
```css
.mobile-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 200;
  height: calc(76px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

3. The bottom nav on the landing page has exactly 4 items:
   - Home: scrolls .welcome-page to top (scrollTop = 0)
   - Command Center: scrolls to #command-center
   - Watchlist: scrolls to #watchlist
   - Top Coins: scrolls to #top-coins

   DO NOT navigate to a different page for these. They are scroll targets on the same page.

4. Scroll implementation:
```js
const scrollToSection = (id) => {
  const welcomePage = document.querySelector('.welcome-page');
  const target = document.getElementById(id);
  if (welcomePage && target) {
    const targetTop = target.offsetTop - 96;
    welcomePage.scrollTo({ top: targetTop, behavior: 'smooth' });
  }
};
```

5. Active state: use 'home' as activeId whenever on welcome view.
   Optionally implement IntersectionObserver on each section for scroll-spy.

---

### FIX 8: RESEARCH ZONE — FULL VIEW ON MOBILE

**The problem:**
Research Zone (ResearchZoneLite) is a 3-column desktop layout.
On mobile it must be a single scrollable column with ALL content preserved.

**The exact mobile layout:**
```
[Back arrow] [Token: BTC] [LITE | PRO]    sub-header 48px, sticky
Token Hero: logo + name + price + 24h     full width glass card
Key metrics: MCap · Vol · FDV · Supply    2x2 grid
Chart — TradingChart                      240px height
Timeframe tabs: 5M 1H 4H 1D 1W          horizontal scroll
Section tabs: Chart | Markets | News | About   horizontal scroll
Tab content (flows to natural height)
Right panel content below tabs:
  Community sentiment bar
  AI signals
```

**What to do:**
1. Open ResearchZoneLite.jsx. Find .research-zone-lite outer container.
2. Open ResearchZoneLite.css. Find the 3-column grid definition.
3. Add mobile override:
```css
@media (max-width: 768px) {
  .research-zone-lite {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .research-zone-lite-left,
  .research-zone-lite-center,
  .research-zone-lite-right {
    width: 100% !important;
    max-width: 100% !important;
    flex: none !important;
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    height: auto !important;
  }

  .research-zone-lite-left  { order: 1; }
  .research-zone-lite-center { order: 2; }
  .research-zone-lite-right  { order: 3; }

  /* Chart height on mobile */
  .research-zone-lite [class*="chart"],
  .research-zone-lite .trading-chart-container {
    height: 240px !important;
    min-height: 240px !important;
  }

  /* Tab bars scroll horizontally */
  .research-zone-lite-tabs,
  [class*="rz-tab"],
  [class*="research-zone-tab"] {
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
  }
}
```

4. The left panel glass cards must match the desktop glass spec.
   Open docs/RESEARCH_ZONE_LEFT_RIGHT_PLAN.md. It specifies the exact values.
   Apply: background: linear-gradient(168deg, #07060a...), border: 1px solid rgba(255,255,255,0.2), border-radius: 24px, the full box-shadow.

5. Sub-header (back button + token name + LITE/PRO toggle):
   - Height: 48px, position: sticky, top: 88px (below mobile header)
   - Back button: 44x44px, returns to previous screen
   - Background: var(--bg-elevated), border-bottom: 1px solid var(--border-subtle)
   - Content below: padding-top accounts for both MobileHeader (88px) + sub-header (48px) = 136px

---

### FIX 9: GM DASHBOARD AND TOP NAV TOOLS

**The problem:**
GM Dashboard and other top-level tools accessible on desktop are not accessible on mobile.

**What to do:**
1. Build the Side Drawer if it does not exist yet. See MOBILE_PRD.md.
   Every desktop sidebar item must be in the drawer.

2. Add a quick-access tools row on the home screen between the welcome widget and command center:
```jsx
// Quick tools row — renders between welcome widget and command center
<div className="mobile-quick-tools">
  <button onClick={() => openGMDashboard()}>GM</button>
  <button onClick={() => navigate('/fear-greed')}>F&G</button>
  <button onClick={() => navigate('/roi-calculator')}>ROI</button>
  <button onClick={() => openSearch()}>Search</button>
</div>
```

Style:
```css
.mobile-quick-tools {
  display: flex;
  gap: 8px;
  padding: 0 16px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mobile-quick-tools button {
  flex-shrink: 0;
  height: 44px;
  min-width: 64px;
  padding: 0 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 12px;
  font-family: var(--font-body);
  cursor: pointer;
}
```

3. GM Dashboard when opened on mobile: must be full-screen overlay.
   Check GMDashboard.jsx — verify position: fixed and z-index: 1000.
   If content is cut off: add overflow-y: auto to its scroll container.

---

## FINAL CHECKLIST BEFORE REPORTING DONE

```
DESIGN
□ Glass cards match desktop exactly — run visual comparison against desktop screenshot
□ Background is #0c0c0e (var(--bg-base)) — not #000, not #111
□ All text uses CSS variables — no hardcoded rgba for text colors
□ All numbers use var(--font-mono)
□ All icons from spectreIcons.jsx — zero Lucide, zero Heroicons, zero emoji as UI

HEADER
□ Shows: hamburger · SPECTRE wordmark · Crypto/Stocks · day/night · search
□ Ticker strip below: BTC · ETH · SOL · F&G · MCap (scrollable, font-mono)
□ Total height: 88px + safe-area-top
□ Day mode override written

LANDING PAGE
□ Welcome widget visible and matches desktop glass
□ AI Brief quote in Playfair Display italic
□ Command Center visible, all tabs scroll horizontally
□ Command Center tab content fully readable, not cut off
□ Watchlist section visible on home page (not navigating to watchlists page)
□ Top Coins section visible, token names NOT truncated
□ Quick tools row between welcome widget and command center

SCROLL
□ .welcome-page scrolls vertically
□ .welcome-page has padding-bottom for bottom nav
□ No overflow: hidden trapping content in panels
□ Command Center tab content flows to natural height

NAVIGATION
□ Desktop NavigationSidebar HIDDEN on mobile (conditional on !isMobile)
□ Bottom nav ONLY at bottom, z-index 200
□ Bottom nav has exactly 4 items for the landing page
□ Bottom nav items scroll to section — do NOT navigate away from welcome page
□ Side Drawer accessible via hamburger and More tab

RESEARCH ZONE
□ Single column on mobile
□ All 3 desktop panels visible in order: left, center, right
□ Left glass matches desktop glass spec from RESEARCH_ZONE_LEFT_RIGHT_PLAN.md
□ Chart renders at 240px height
□ Tab bars scroll horizontally
□ Back button present and functional
□ Sub-header sticky below MobileHeader

ALL PAGES
□ Day mode override for every modified element
□ Touch targets: all interactive elements minimum 44x44px
□ Safe area: header and bottom nav clear Dynamic Island and home indicator
□ No spinners — skeleton shimmer only
□ Skeleton shimmer on all loading states
```

---

## WHAT YOU MUST NOT DO

```
DO NOT create new glass styles — use the existing ones from WelcomePage.css
DO NOT create new color variables — use var(--accent), var(--bull), var(--bear), etc.
DO NOT create new icon components — use spectreIcons.jsx ONLY
DO NOT replace MobileHeader.jsx or MobileBottomNav.jsx — extend them
DO NOT add overflow: hidden to any container that has scrollable content
DO NOT render NavigationSidebar on mobile
DO NOT hardcode hex colors — use CSS variables
DO NOT navigate away from the welcome page when user taps Command Center, Watchlist, or Top Coins
DO NOT truncate token names
DO NOT use generic card styles — study WelcomePage.css and match it
DO NOT add spinners — skeleton shimmer only
DO NOT skip the day mode override for any component you modify
DO NOT guess class names — read the actual file
```

---

## REPORTING FORMAT

After completing each fix:

```
FIX [N] COMPLETE:
- Files modified: [exact file list]
- Classes modified: [exact CSS class list]
- What was wrong: [one sentence]
- What is now correct: [one sentence]
- Day mode covered: YES / NO
- Tested at 390px viewport: YES / NO
- Screenshot confirms match with desktop design: YES / NO
```

Only move to the next fix after reporting the previous one.
