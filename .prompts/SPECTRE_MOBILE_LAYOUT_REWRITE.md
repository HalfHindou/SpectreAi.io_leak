# SPECTRE MOBILE — LAYOUT ARCHITECTURE REWRITE
# The problem: tables in tables. Cards in cards. No hierarchy.
# The fix: one depth level. Sections separated by space and type, not borders.

---

## READ FIRST — MANDATORY BOOT

```
1. SPECTRE_DESIGN_LAW.md              ← law
2. src/index.css                      ← tokens
3. src/components/WelcomePage.jsx     ← study the desktop
4. src/components/WelcomePage.css     ← study the glass system
5. src/icons/spectreIcons.jsx         ← only icons allowed
```

State what you found before writing anything.

---

## THE CORE PROBLEM — UNDERSTAND THIS BEFORE ANY CODE

Look at the current mobile screenshot:

```
[white card]                          ← Command Center outer
  [white card]                        ← AI Brief inner
    [white card]                      ← quote container
      text
  [white card]                        ← tab bar

[white card]                          ← Watchlist outer
  [white card]                        ← search input
  [white card]                        ← AAPL row
  [white card]                        ← MSFT row
```

Every level is the same visual weight. The eye cannot find a hierarchy.
Nothing tells the user what is primary vs secondary vs tertiary.
The background, the cards, and the rows are all the same white.

**The correct mobile mental model:**

```
BACKGROUND                            ← var(--bg-base) #0c0c0e — the void
  SECTION HEADER (no card)            ← just text + spacing
  DATA ROW (single card depth)        ← one glass surface per item
  DATA ROW
  SECTION HEADER (no card)
  DATA ROW
```

Only ONE level of card depth. Everything else is spacing and typography.

---

## THE NIGHT MODE PROBLEM — FIX THIS FIRST

The screenshot shows day mode active (white background).
The Spectre design law says: **dark is default. Always.**

Night mode is not a preference. It is the product.

**Immediate fix in AppShell.jsx or App.jsx:**
```jsx
// On first load, if no stored preference, default to night mode
const { dayMode } = useSettingsStore();
// dayMode should default to FALSE in the store initial state
// Check useSettingsStore.js — find the initial state for dayMode
// If it is true or undefined, change the initial value to false
```

In `src/store/useSettingsStore.js`:
```js
const initialState = {
  dayMode: false,  // ← MUST be false. Night mode is default.
  // ... rest of state
}
```

After fixing the default, verify: on fresh load (cleared localStorage), the app opens in night mode.

---

## THE NEW MOBILE LAYOUT ARCHITECTURE

No more cards in cards. Here is the exact architecture for every screen.

### PRINCIPLE 1: THE BACKGROUND IS THE CANVAS

```css
/* The page background IS the design surface */
.mobile-page {
  background: var(--bg-base); /* #0c0c0e */
  min-height: 100dvh;
  padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));
}
```

Individual sections do NOT get a background card. They sit directly on the void.
Sections are separated by:
- 24px vertical gap
- An optional 1px separator: `border-top: 1px solid var(--border-subtle)`
- A section label in 11px uppercase var(--text-muted)

### PRINCIPLE 2: ONE CARD DEPTH ONLY

A "card" on mobile is a single glass surface. Nothing sits inside a card as another card.

```
CORRECT:                              WRONG:
[glass card: token row]               [glass card: section]
[glass card: token row]                 [glass card: token row]
[glass card: token row]                 [glass card: token row]
```

If you have a section that contains multiple items, the items are the cards.
The section itself is NOT a card — it is labeled whitespace.

### PRINCIPLE 3: ROWS NOT BOXES

Data lives in ROWS, not boxes.

```
WRONG (what exists):                  CORRECT:
┌─────────────────────┐              ─────────────────────────
│ ┌──────┐  AAPL      │              [logo] AAPL · Apple Inc.
│ │ logo │  Apple Inc.│              $250.12     +0.00%    [∿]
│ └──────┘  $250.12   │              ─────────────────────────
│           +0.00%    │              [logo] MSFT · Microsoft
└─────────────────────┘              $395.55     +0.12%    [∿]
                                     ─────────────────────────
```

The row IS the card. 56px height, glass background, separated by 1px border-bottom.
No outer card wrapping a list of inner cards.

---

## SECTION 1: HOME SCREEN LAYOUT REWRITE

### The new home screen structure (top to bottom):

```
━━━ MOBILE HEADER (88px, fixed) ━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ AI BRIEF (full-bleed glass card) ━━━━━━━━━━━━━━━━━━━━━

  This is the ONLY card on the home screen.
  Everything else is sections with rows.

━━━ MARKET PULSE (section, no card) ━━━━━━━━━━━━━━━━━━━━━━

  BTC.D 56.8%  ·  MCap $2.49T  ·  Gas 12  ·  BTC Season

━━━ QUICK TOOLS (icon row, no card) ━━━━━━━━━━━━━━━━━━━━━━

  [☀ GM]  [😨 F&G]  [💰 ROI]  [📅 Cal]  [🔬 Research]

━━━ COMMAND CENTER (full-bleed section) ━━━━━━━━━━━━━━━━━━━

  Tab bar: AI Brief | AI Market | News | Heatmaps | ...
  ─────────────────────────────────────────
  Tab content (no extra card wrapping)

━━━ MY WATCHLIST (section label + rows) ━━━━━━━━━━━━━━━━━━

  MY WATCHLIST                                    [See all →]
  ─────────────────────────────────────────────────────────
  [BTC logo] Bitcoin           $70,473    ▼1.20%  [sparkline]
  ─────────────────────────────────────────────────────────
  [ETH logo] Ethereum          $2,074     ▼1.06%  [sparkline]
  ─────────────────────────────────────────────────────────
  [SOL logo] Solana            $87.14     ▼1.70%  [sparkline]
  ─────────────────────────────────────────────────────────
  + Add token
  ─────────────────────────────────────────────────────────

━━━ TOP COINS (section label + rows) ━━━━━━━━━━━━━━━━━━━━━

  TOP COINS            [All] [DeFi] [AI] [Meme] [→]
  ─────────────────────────────────────────────────────────
  1  [BTC] Bitcoin      $70,702    ▼0.79%   $1.41T  [∿]
  ─────────────────────────────────────────────────────────
  2  [ETH] Ethereum     $2,081     ▼0.68%   $251B   [∿]
  ─────────────────────────────────────────────────────────

━━━ BOTTOM NAV (76px, fixed) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## SECTION 2: AI BRIEF CARD (the hero — the ONLY full card)

The AI Brief is the one moment where a full glass card is justified.
It is the intelligence product. It deserves the premium treatment.

```css
.mobile-ai-brief-card {
  margin: 12px 16px;
  padding: 20px;
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
  /* Purple ambient behind the card */
  position: relative;
}
.mobile-ai-brief-card::before {
  content: '';
  position: absolute;
  inset: -20px;
  background: radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.08) 0%, transparent 70%);
  pointer-events: none;
  z-index: -1;
}

/* Quote — the editorial moment */
.mobile-ai-brief-quote {
  font-family: var(--font-cinema); /* Playfair Display */
  font-style: italic;
  font-size: 18px;
  line-height: 1.5;
  color: var(--text-primary);
  text-align: center;
  margin: 16px 0;
  /* If quote is long, scale down to 16px */
}

/* Stat pills row */
.mobile-ai-brief-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.mobile-ai-brief-stat {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--text-secondary);
}
.mobile-ai-brief-stat.fear {
  background: rgba(239,68,68,0.10);
  color: var(--bear);
  border-color: rgba(239,68,68,0.2);
}

/* Action row */
.mobile-ai-brief-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  align-items: center;
}
.mobile-ai-brief-listen {
  height: 40px;
  padding: 0 20px;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
}
.mobile-ai-brief-fullbtn {
  font-size: 13px;
  color: var(--text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
```

Day mode for the AI Brief card — it keeps the dark glass even in day mode:
```css
/* AI Brief card stays dark regardless of day mode — it's the intelligence core */
.app-day-mode .mobile-ai-brief-card {
  background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.app-day-mode .mobile-ai-brief-quote {
  color: rgba(255,255,255,0.95);
}
```

---

## SECTION 3: MARKET PULSE BAR (no card, just text)

```jsx
<div className="mobile-market-pulse">
  <span>BTC.D <strong>56.8%</strong></span>
  <span className="sep">·</span>
  <span>MCap <strong>$2.49T</strong></span>
  <span className="sep">·</span>
  <span>Gas <strong>12</strong></span>
  <span className="sep">·</span>
  <span className="season-tag">BTC Season</span>
</div>
```

```css
.mobile-market-pulse {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  height: 36px;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
}
.mobile-market-pulse strong {
  color: var(--text-secondary);
  font-weight: 500;
}
.mobile-market-pulse .sep {
  color: var(--border-default);
  user-select: none;
}
.mobile-market-pulse .season-tag {
  background: rgba(247,147,26,0.12);
  color: #f7931a;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 500;
}
```

No card. No background. Just a line of data sitting on the page background.

---

## SECTION 4: QUICK TOOLS ROW (no card, icon strip)

```jsx
<div className="mobile-quick-tools">
  {[
    { id: 'gm',       label: 'GM',      icon: spectreIcons.sun,      action: openGMDashboard },
    { id: 'fg',       label: 'F&G',     icon: spectreIcons.gauge,    action: () => navigate('/fear-greed') },
    { id: 'roi',      label: 'ROI',     icon: spectreIcons.calculator, action: () => navigate('/roi-calculator') },
    { id: 'calendar', label: 'Calendar', icon: spectreIcons.calendar, action: () => navigate('/economic-calendar') },
    { id: 'research', label: 'Research', icon: spectreIcons.search,  action: () => navigate('/research-zone') },
  ].map(tool => (
    <button key={tool.id} className="mobile-quick-tool" onClick={tool.action}>
      {tool.icon({ className: 'mobile-quick-tool-icon' })}
      <span className="mobile-quick-tool-label">{tool.label}</span>
    </button>
  ))}
</div>
```

```css
.mobile-quick-tools {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mobile-quick-tool {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 60px;
  padding: 10px 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  min-height: 56px;
  /* touch target: 60px wide, 56px tall — within spec */
}
.mobile-quick-tool-icon {
  width: 18px;
  height: 18px;
  color: var(--text-tertiary);
}
.mobile-quick-tool-label {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-body);
  line-height: 1;
}
/* Day mode */
.app-day-mode .mobile-quick-tool {
  background: rgba(0,0,0,0.04);
  border-color: rgba(0,0,0,0.08);
}
.app-day-mode .mobile-quick-tool-icon { color: rgba(0,0,0,0.4); }
.app-day-mode .mobile-quick-tool-label { color: rgba(0,0,0,0.35); }
```

---

## SECTION 5: COMMAND CENTER (full bleed, no outer card)

The Command Center is NOT a card. It is a section of the page.
The tab content sits directly on the page background.

```css
.mobile-command-center {
  /* No background. No border. No card. */
  margin-top: 4px;
}

.mobile-command-center-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 0;
}
.mobile-command-center-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Tab bar — sits on page background */
.mobile-command-center-tabs {
  display: flex;
  gap: 0;
  padding: 8px 16px 0;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-subtle);
}
.mobile-command-center-tab {
  flex-shrink: 0;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  min-height: 44px;
  display: flex;
  align-items: center;
}
.mobile-command-center-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Tab content — glass card ONLY for the content panel, NOT a wrapper */
.mobile-command-center-content {
  margin: 12px 16px;
  padding: 16px;
  background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.3);
  /* Content inside is text, not more cards */
}
```

Day mode for Command Center:
```css
.app-day-mode .mobile-command-center-content {
  background: rgba(0,0,0,0.02);
  border-color: rgba(0,0,0,0.08);
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.app-day-mode .mobile-command-center-tab.active {
  /* Accent changes based on market sentiment in day mode */
  color: var(--accent);
  border-bottom-color: var(--accent);
}
```

---

## SECTION 6: WATCHLIST ROWS (no outer card)

The watchlist section is NOT a card. It is labeled rows.

```jsx
<section className="mobile-section">
  <div className="mobile-section-header">
    <span className="mobile-section-label">My Watchlist</span>
    <button className="mobile-section-action">See all →</button>
  </div>

  {tokens.map(token => (
    <WatchlistRow key={token.id} token={token} />
  ))}

  <button className="mobile-add-row">
    + Add token
  </button>
</section>
```

```css
/* Section — sits directly on page background */
.mobile-section {
  margin-top: 24px;
}

.mobile-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 8px;
}
.mobile-section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.mobile-section-action {
  font-size: 12px;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

/* Row — THIS is the card. One depth only. */
.mobile-token-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  height: 60px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background 80ms;
}
.mobile-token-row:first-of-type {
  border-top: 1px solid var(--border-subtle);
}
.mobile-token-row:active {
  background: var(--bg-hover);
  transform: scale(0.99);
}

/* Token logo */
.mobile-token-logo {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

/* Token name column */
.mobile-token-name-col {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.mobile-token-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  /* NEVER overflow: hidden or text-overflow: ellipsis */
}
.mobile-token-symbol {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 1px;
}

/* Price column */
.mobile-token-price-col {
  text-align: right;
  flex-shrink: 0;
}
.mobile-token-price {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}
.mobile-token-change {
  font-family: var(--font-mono);
  font-size: 11px;
  margin-top: 2px;
}
.mobile-token-change.positive { color: var(--bull); }
.mobile-token-change.negative { color: var(--bear); }

/* Sparkline */
.mobile-token-sparkline {
  width: 48px;
  height: 24px;
  flex-shrink: 0;
}

/* Add token row */
.mobile-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 48px;
  padding: 0 16px;
  background: none;
  border: none;
  border-top: 1px dashed var(--border-subtle);
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
```

Day mode for rows:
```css
.app-day-mode .mobile-token-row {
  background: #ffffff;
  border-bottom-color: rgba(0,0,0,0.06);
}
.app-day-mode .mobile-token-row:first-of-type {
  border-top-color: rgba(0,0,0,0.06);
}
.app-day-mode .mobile-token-row:active {
  background: rgba(0,0,0,0.03);
}
.app-day-mode .mobile-token-name { color: rgba(0,0,0,0.90); }
.app-day-mode .mobile-token-symbol { color: rgba(0,0,0,0.35); }
.app-day-mode .mobile-token-price { color: rgba(0,0,0,0.90); }
```

---

## SECTION 7: TOP COINS (same pattern — section label + rows)

Identical to watchlist rows but with rank number:

```jsx
<section className="mobile-section" id="top-coins">
  <div className="mobile-section-header">
    <span className="mobile-section-label">Top Coins</span>
    <div className="mobile-section-filters">
      {['All','DeFi','AI','Meme'].map(cat => (
        <button key={cat} className={`mobile-filter-pill ${activeFilter === cat ? 'active' : ''}`}>
          {cat}
        </button>
      ))}
      <button className="mobile-filter-more">→</button>
    </div>
  </div>

  {coins.map((coin, i) => (
    <TopCoinRow key={coin.id} coin={coin} rank={i + 1} />
  ))}
</section>
```

```css
.mobile-section-filters {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mobile-filter-pill {
  flex-shrink: 0;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  min-height: 28px;
}
.mobile-filter-pill.active {
  background: rgba(139,92,246,0.12);
  border-color: rgba(139,92,246,0.3);
  color: var(--accent);
}

/* Top coin row — same base as token row, adds rank */
.mobile-top-coin-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 60px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
}
.mobile-top-coin-rank {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  width: 20px;
  flex-shrink: 0;
  text-align: right;
}
/* Rest: same as .mobile-token-row internals */
/* Mcap shows below price in small text */
.mobile-top-coin-mcap {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 2px;
}
```

---

## SECTION 8: THE SIDE DRAWER (replaces nested icon table)

The current icon strip (Research, Screener, Watchlists, Fear/Greed, Social, X Dash)
is trying to be a mini nav inside the page. Wrong. It wastes space and has no depth.

Remove it from the home page entirely.
All those destinations live in the Side Drawer, accessed via the hamburger.

The Side Drawer spec is already in MOBILE_PRD.md.
Build it now if it does not exist.

Drawer critical CSS:
```css
.mobile-side-drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(300px, 80vw);
  z-index: 300;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border-default);
  transform: translateX(-100%);
  transition: transform 280ms cubic-bezier(0.4, 0, 0.2, 1);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.mobile-side-drawer.open {
  transform: translateX(0);
}
.mobile-side-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 299;
  background: rgba(0,0,0,0.6);
  opacity: 0;
  pointer-events: none;
  transition: opacity 280ms;
}
.mobile-side-drawer-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}
```

Day mode drawer:
```css
.app-day-mode .mobile-side-drawer {
  background: #ffffff;
  border-right-color: rgba(0,0,0,0.10);
}
```

---

## SECTION 9: WHAT TO DELETE

These patterns must be removed from the mobile layout entirely:

```
DELETE: Any outer card wrapping a list of inner rows
DELETE: The icon grid strip that shows Research/Screener/Watchlists/Fear/Social/X
        (it goes in the drawer, not the page)
DELETE: Any nested card patterns (card > card > data)
DELETE: Any white background on the page root in night mode
DELETE: Any overflow: hidden on panels that contain scrollable content
DELETE: Generic box-shadow: 0 2px 4px rgba(0,0,0,0.1) — wrong glass system
DELETE: Any border-radius less than 12px on cards (except buttons)
DELETE: Any font-size below 11px
DELETE: Any hardcoded hex colors — use CSS variables
```

---

## SECTION 10: VISUAL HIERARCHY REFERENCE

When you look at any screen, you should see this hierarchy:

```
LAYER 1 (void)    var(--bg-base) #0c0c0e         ← the page
LAYER 2 (surface) var(--bg-surface) #131316       ← token rows, tab bars
LAYER 3 (glass)   rgba(255,255,255,0.04-0.05)     ← AI Brief card, content panels
LAYER 4 (elevated) var(--bg-elevated) #1a1a1f     ← header, bottom nav, drawer
LAYER 5 (accent)  var(--accent) #8B5CF6           ← active states, primary CTAs only
```

If you look at the screen and cannot identify these 5 layers distinctly — the hierarchy is wrong.
The AI Brief card should glow faintly on the void. Rows should sit on a subtly lighter surface.
The header and nav should feel anchored and elevated. The accent should be rare and meaningful.

---

## REPORTING

After completing all 9 sections:

```
ARCHITECTURE COMPLETE:

Night mode default: CONFIRMED / STILL BROKEN
AI Brief card: GLASS MATCHES DESKTOP / DOES NOT MATCH
Page background: #0c0c0e / WRONG (describe actual)
Token rows: ONE DEPTH LEVEL / STILL NESTED
Command Center: SECTION + TABS (no outer card) / STILL CARD IN CARD
Watchlist: SECTION + ROWS / STILL CARD IN CARD
Top Coins: SECTION + ROWS / STILL CARD IN CARD
Icon strip: REMOVED → DRAWER / STILL ON PAGE
Side Drawer: BUILT / NOT BUILT
Day mode: EVERY ELEMENT COVERED / MISSING ON [list]
Visual hierarchy: 5 LAYERS VISIBLE / FLAT
```
