---
paths:
  - "apps/research/src/pages/**/*.mobile.css"
  - "apps/research/src/pages/**/mobile-*"
  - "apps/research/src/components/mobile-*"
  - "apps/research/src/pages/research-zone/components/research-zone-mobile*"
  - "apps/trading/src/components/TradingChart*"
---

# Spectre Mobile Crypto/Stock UX — Deep Reference

**Reference apps studied:** Bybit, Binance, CoinMarketCap, Nansen.
**Explicitly rejected:** CoinGecko. Their mobile UI is cluttered, uses 3 font weights per row, has inconsistent spacing, stale interactions. Do not emulate.

**Companion docs:** `mobile-design-system.md` (tokens + shell), `design-system.md` (cinematic tokens), `coding-standards.md` (file conventions).

**Core thesis:** On mobile, data is the interface. Chrome disappears. Numbers dominate. Every screen collapses into: **identity → price → action → data rows**.

---

## A. The Four Reference Apps — What Each Does Best

### A1. Bybit — Trade Velocity
- **Decisive bottom action:** 50/50 Buy/Sell docked at screen bottom, full-width, large tap targets. Always accessible.
- **Live order book depth bars:** horizontal red/green bars extending from mid-price, filling proportionally to order size. Cognitive load is zero — eye reads liquidity at a glance.
- **Percentage shortcut row:** `25 · 50 · 75 · 100%` chips for position sizing. No typing.
- **Leverage slider with discrete stops:** 1x / 5x / 10x / 25x / 50x / 100x marked on the track.
- **Mark/Index/Funding** rendered as 3 tiny grey rows above the chart — easy to ignore, instantly available.

### A2. Binance — Data Density
- **Horizontal segmented control over lists:** `Favorites · Spot · Futures · Options · Earn`. Tap = instant filter, no load state.
- **24h sparkline on every row:** right-aligned, 40px wide, 16px tall, single stroke, colored by 24h direction. Cheap visual proof of trend.
- **Magnitude-graded color:** `>5%` uses full `--bull/--bear` saturation. `<1%` uses `0.4` alpha. `0%` shows muted gray. The screen breathes.
- **Convert flow:** From / To with giant input, rate `1 BTC = 17.3 ETH` below, "All" max button inside input, Swap icon to flip.
- **Funding countdown:** MM:SS ticker next to funding rate — creates urgency.
- **Pull-to-refresh with custom illustration:** never generic spinner.

### A3. CoinMarketCap — Information Architecture
- **Sticky section nav:** `Overview · Markets · Historical · News · About · Holders · Socials` as horizontal pill bar that sticks after scrolling past the chart.
- **Key Metrics card:** 2-column grid. Every row: `LABEL · value`. MCap, Vol(24h), FDV, Vol/MCap %, Circulating, Max Supply.
- **24h Low/High bar:** gradient bar with a white dot at current-price position. Low on left, High on right.
- **Price Performance table:** `7d / 30d / 3m / 6m / 1y` each as a row with colored bar width = magnitude, % on the right.
- **Converter widget:** simple 2-row calculator. `1 BTC = $X` / `$X = 0.0000133 BTC`.
- **ATH/ATL with context:** `ATH: $69,045 · Apr 14, 2021 · -41.2%`. One line, three pieces of info.
- **Exchange table:** rank · exchange · pair · type chip · price · +2% depth · −2% depth · 24h vol · %share · trust.

### A4. Nansen — Smart Money Minimal
- **Content floats on true black.** No card chrome. Borders at `rgba(255,255,255,0.04)` — barely there.
- **Purple/pink accents for "intelligence" UI** (Smart Money labels, whale alerts). Everything else is grayscale.
- **Entity labels:** wallets render with human-readable name chips (e.g. `Jump Trading`, `Alameda`) instead of raw addresses.
- **Large numbers, tight tracking:** PnL `+$2,847,291` set in 28px sans-serif, `letter-spacing: -0.02em`, `tabular-nums`.
- **Filter chips over content:** `All · Buys · Sells · Transfers` as ghost pills at top of any transaction list.
- **Segmented time range on hero:** `24h · 7d · 30d · All` for any chart.
- **Wallet context card:** avatar + name + address (truncated `0xabc…def`) + copy button + Etherscan external link.

---

## B. Universal Crypto Mobile Laws

### B1. Numbers Are the Interface
- Every price, amount, %, count, timestamp — `font-variant-numeric: tabular-nums` ALWAYS.
- **Font choice is contextual:**
  - Dashboard/data-heavy context (main app, research zone, trading): system sans (`-apple-system, SF Pro Display, system-ui`) with `tabular-nums`. Feels native, not terminal.
  - Trading-terminal context (explicit chart price overlays, order entry, price ladders): `var(--font-mono)` (JetBrains Mono). Emphasizes precision.
- **Never mix** weights in a single row. A token row is `600 · 600 · 500` — name bold, price bold, symbol regular. Not `700 / 400 / 600`.

### B2. Color Magnitude Grading
Price-change color is NOT binary. Scale alpha by magnitude:

```
abs(change%) < 0.5  → muted (0.4 alpha)
abs(change%) < 2    → soft (0.7 alpha)
abs(change%) < 5    → full (1.0 alpha)
abs(change%) >= 5   → full + background tint
abs(change%) >= 10  → full + bright variant (--bull-bright / --bear-bright)
```

Keeps low-volatility majors (BTC, ETH) quiet while small caps pop.

### B3. Row Density Targets
- **Token list row:** 56–64px min-height. Logo 32–36px. One-tap reveals actions.
- **Exchange row:** 60–72px. Two lines: name + pair on left, price + vol on right.
- **Stats row:** 40–44px. Label left, value right, single line.
- **News row:** 72–88px. Thumbnail 64×64 square on right, text left.

### B4. The Six-Gesture Bible
| Gesture | Action |
|---------|--------|
| Tap | Primary: open detail / toggle |
| Long-press | Reveal actions menu (copy address, remove from watchlist, share) |
| Swipe-left on row | Reveal destructive action (delete, unfollow) with red slide-out |
| Swipe-right on row | Reveal positive action (star, add to watchlist) with green slide-out |
| Pull-down at top | Refresh data (rubber-band at >64px threshold) |
| Pinch on chart | Zoom timeline (horizontal) OR price (vertical) based on dominant axis |

Never bind multi-finger gestures for anything critical — touch targets fail too often.

### B5. Always-Docked Action Bar
Every token/asset page gets a fixed bottom action bar at `bottom: var(--m-bottom-nav-h)`:

- **Crypto:** 50/50 `[Buy]` `[Sell]` buttons OR single `[Trade]` CTA (+ star toggle on the right).
- **Stock:** single `[Trade]` CTA (+ watchlist toggle) — no direct buy/sell UI until after-hours handling clarified.
- **Prediction market:** 50/50 `[YES ¢X]` `[NO ¢Y]` with the current price on the button itself.

The bar floats with a 30% gradient fade at top so content fades into it.

### B6. Skeleton Shimmer Over Spinners
Never render text `Loading...` or a spinner on a crypto screen. Always a skeleton that matches the exact shape of the incoming content. The user sees the layout BEFORE the data — perceived speed doubles.

---

## C. The Price Hero Pattern

The top of any token/asset screen. Proven sequence (all four reference apps converge here):

```
┌─────────────────────────────────────────────┐
│ [Logo 40px] Bitcoin                    [★]  │  ← identity row
│             BTC · Rank #1 · Layer 1          │     44px touch target on star
├─────────────────────────────────────────────┤
│ $74,320.24                        +0.43%    │  ← price hero
│ (38–42px, tabular, -0.02em tracking)         │     (change pill, 14px)
├─────────────────────────────────────────────┤
│ 1H −0.3%  24H +0.4%  7D +4.5%  30D −2.1%     │  ← perf scrubber (ghost pills)
├─────────────────────────────────────────────┤
│ 24H RANGE                                    │
│ $73,309 ▓▓▓▓▓▓▓●═════════════  $75,425       │  ← range bar with dot
└─────────────────────────────────────────────┘
```

**Rules:**
- Price tagline is 38–42px, weight 700, kerning `-0.03em`, system sans with tabular-nums.
- Change pill sits to the right of the price (not below). Color is semantic, background is `0.06` alpha of the same color.
- Perf pills row is `overflow-x: auto` with `scrollbar-width: none` — 4 fits on iPhone SE, 6 fits on Pro Max.
- Range bar: 4px tall, gradient bear→bull, current-price dot is 10px white disc with 2px void border.

---

## D. The Chart Toolbar Collapse

Mobile charts cannot carry desktop chrome. The rule is TWO ROWS MAX:

```
Row 1: [Type pill group]   [Price|MCap pill group]
Row 2: [1m][5m][15m][1h][4h][1D][1W]  ← full-width
```

**What dies on mobile:**
- Drawing tools (trend, fib, rectangle, text) — saved for desktop.
- Indicator picker — show 1 default indicator (RSI or volume), no picker.
- Color pickers — token brand color or line is auto-derived.
- NextGen/view-mode tabs (Trading / Overlay / Bubbles) — only trading view on mobile.
- ATH/VWAP/Heatmap toggle buttons — promote to settings sheet if demanded.

**What lives:**
- Chart type: 2–3 buttons max (Candle, Line, optionally TradingView).
- Y-axis toggle: Price / MCap.
- Timeframe pills: 6–7 options max, equally sized.

Toolbar row gap target: 6px. Padding: 8–12px horizontal. Container is transparent — the chart background IS the toolbar background.

---

## E. The Token List Row Pattern

The most rendered component in any crypto app. Specs:

```
┌──────────────────────────────────────────────────────────┐
│  [32px]  Symbol             ~sparkline~         $74,320  │
│   logo   Name / meta              40×16            +0.4% │
└──────────────────────────────────────────────────────────┘
       ↑            ↑                  ↑               ↑
       1            2                  3               4
```

- **Zone 1:** 32px circle, object-fit cover, brand-color fallback (initial + `tokenColors.js`).
- **Zone 2:** symbol 15px weight 600 + name/meta 12px weight 500 at 50% opacity, two-line stack.
- **Zone 3:** inline SVG sparkline, 40w×16h, single stroke, 1.5px width, colored by 24h sign, subsampled to ~20 points.
- **Zone 4:** price 15px tabular-nums + change 12px pill.

**Row height:** 56px compact / 64px relaxed. **Separator:** `1px rgba(255,255,255,0.025)` indented to start at 56px from left (logo clears it).

**On tap:** open detail. **On long-press:** menu with `Add to watchlist · View on Etherscan · Copy address · Share`. **On swipe-left:** reveal destructive (`Remove from watchlist`).

---

## F. Exchange / Market Row Pattern

For market listings (Bybit, Binance, OKX, etc):

```
┌───────────────────────────────────────────────────┐
│  Binance          BTC/USDT  [SPOT]       $74,322  │
│  Trust: 10                  Vol $1.2B  +0.48%     │
└───────────────────────────────────────────────────┘
```

- Exchange name bold, pair grey below.
- Market type chip: `SPOT` (green tint), `PERP` (yellow), `FUTURES` (blue), `DEX` (purple/pink).
- Right stack: live price + 24h volume + %change.
- Trust indicator as tiny badge (Binance green dot, tier-2 yellow).
- On tap: open exchange page / TradingView symbol.

---

## G. Order Entry Inline Pattern (Bybit-style)

When a swap/order UI must live inside a page (not a full sheet):

```
┌─────────────────────────────────────────┐
│  Price (USDT)                            │
│  ┌───────────────────────────────────┐   │
│  │ 74,320.00                    [Mkt]│   │  ← giant input
│  └───────────────────────────────────┘   │
│                                          │
│  Amount (BTC)                            │
│  ┌───────────────────────────────────┐   │
│  │ 0.0125                            │   │
│  └───────────────────────────────────┘   │
│  ┌─ 25% ─┬─ 50% ─┬─ 75% ─┬─ 100% ─┐      │  ← % shortcuts
│  └───────┴───────┴───────┴────────┘      │
│                                          │
│  Total: $929.00      Fee: $0.93 (0.1%)   │
│  ┌─────────────┐  ┌─────────────┐         │
│  │    BUY      │  │    SELL     │         │  ← 50/50 actions
│  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────┘
```

- Inputs: 18–20px value, 11px uppercase label above.
- `[Mkt]` chip inside price input toggles limit/market.
- Percentage chips are ghost capsules (transparent, border `0.5px`), tap fills amount to the pct of available balance.
- Total/Fee line is 13px secondary, single row.
- Buy/Sell buttons: full green/red background, 48px height, 16px weight 600.

---

## H. Prediction Market Card Pattern

Used for Polymarket / Kalshi integrations:

```
┌─────────────────────────────────────────┐
│  Will BTC hit $100k by EOY 2026?         │
│  Ends Dec 31 · Vol $4.2M                 │
│                                          │
│  ┌─── YES ────┐  ┌─── NO ─────┐           │
│  │    68¢     │  │    32¢     │           │
│  └────────────┘  └────────────┘           │
└─────────────────────────────────────────┘
```

- Question renders as 14px weight 500, max 2 lines, ellipsis.
- Meta line: 11px muted.
- Yes/No buttons: pill-shaped, green bg `rgba(16,185,129,0.08)` / red `rgba(239,68,68,0.08)` with darker text. Tap = bet flow.

---

## I. Smart Money / Nansen-Style Entity Cards

For AI / on-chain intelligence sections:

```
┌─────────────────────────────────────────┐
│  🟣  Jump Trading                        │
│      0xf3b…c41d · Copied                 │
│                                          │
│  Recent activity                         │
│  └─ Bought $2.1M BTC · 2h ago            │
│  └─ Sold $800k ETH · 5h ago              │
└─────────────────────────────────────────┘
```

- Purple dot as entity indicator (smart money = purple, whale = pink, institution = blue).
- Truncated address with copy button (inline).
- Activity list: simple bullet lines, no table.
- Card has subtle purple gradient on border (`rgba(139,92,246,0.1)` border).

**Use purple SPARINGLY.** Only for AI/smart-money/alpha features. Never for regular UI.

---

## J. News Card Pattern

```
┌─────────────────────────────────────────────┐
│  Bitcoin reclaims $75k amid ETF        ┌───┐ │
│  inflows of $847M weekly              │ IMG │ │
│  CoinDesk · 2h ago                     └───┘ │
└─────────────────────────────────────────────┘
```

- Headline 14px weight 600, max 2 lines.
- Meta line: `Source · time ago` 11px muted.
- Thumbnail 64×64 square, `object-fit: cover`, 8px radius, right-aligned.
- Row height ~72–88px.
- **Source badge vs source text:** use text (faster to read). Icons only for top-tier (Bloomberg, WSJ, CoinDesk). Never "Powered by X" badges.

---

## K. Stock-Specific Mobile Additions

Stocks share most patterns, with these additions:

- **Market hours banner:** tiny pill at top-right of price hero. `● OPEN` (green pulse), `● PRE-MARKET` (amber), `● AFTER HOURS` (blue), `● CLOSED` (grey).
- **52W range bar:** same as 24h range, but low/high are the 52-week values. Dot shows current % through range.
- **Fundamentals grid (2×3):** `P/E · EPS · Div Yield · Mkt Cap · Avg Vol · Beta`.
- **Earnings card:** if earnings in next 30 days, render a countdown card above markets: `Earnings in 12 days · Est EPS $1.42 · Est Rev $87B`.
- **Sector sentiment bar:** 1-line gauge showing the sector's 24h change vs the stock.
- **News section priority:** SEC filings badge stays ALWAYS at top if present.

---

## L. Anti-Patterns (Do Not Do These)

| Anti-pattern | Why it fails | Correct |
|--------------|-------------|---------|
| Price in monospace, change in sans | Visual mismatch; feels unfinished | One font family per row |
| Chart with 8+ toolbar buttons | Overflows, users can't tap | Collapse to type + TF only |
| Generic "Loading..." text | Reads as broken | Shimmer skeleton matching shape |
| Trade button halfway up the screen | User loses it while scrolling | Sticky docked at bottom |
| Full-width sparkline in token row | Pushes price off-screen | 40px right-aligned inline SVG |
| Icon + text label for every chart TF | Row overflows at 380px | Text only, 32px min-width |
| Confirmation modal for watchlist | Tap friction | One-tap toggle with haptic |
| Green "positive" on bear market | Color disorientation | Always `--bull`/`--bear` semantic |
| Copying CoinGecko's crammed rows | CG uses 3 weights + bad spacing | Follow Binance/CMC density |
| Putting the timeframe bar ABOVE the chart | Breaks muscle memory | TF bar sits BELOW chart |
| Non-tabular numbers (prices jump column) | Eye has to re-track decimal | Always `font-variant-numeric: tabular-nums` |
| Pulsing dot that isn't connected to a live feed | Cry-wolf indicator | Only pulse when data genuinely streams |
| Decorative emojis in UI (🚀 📈 💰) | Reads as Web3 junk-app | Icons only, never emoji |
| Gradient hero backgrounds (purple→blue) | Dates the app to 2022 | Flat void with subtle token-branded glow |
| "Discover" / "Explore" empty-state with cartoon | Looks juvenile | Short one-liner + CTA, no illustration |

---

## M. Spectre-Specific Application Notes

- **Chart component:** `apps/research/src/components/trading-chart.jsx` is the shared chart. Mobile scoping belongs in the page's `.mobile.css`, NEVER in the base chart CSS. Use `.{page-prefix}-chart-wrap .chart-controls { … }` scoping.
- **Token colors:** `apps/research/src/constants/tokenColors.js` has 200+ brand colors. Use `TOKEN_ROW_COLORS[sym]?.bg` for RGB fallback avatars and ambient glows.
- **Data pipeline:** existing hooks already normalize data — do not refetch inside mobile components. Accept via props and render.
- **i18n:** mobile rows use `t('…')` keys. Add keys to `src/i18n/en.json` first, then fall back English where missing.
- **Haptics:** not yet implemented. If added, `navigator.vibrate([10])` on CTA taps only, never on scroll.
- **Pull-to-refresh:** use `usePullToRefresh` from `src/hooks/`. Already wired on the Welcome page.
- **Live tickers:** use `useAdaptivePolling` — it pauses when tab hidden.

---

## N. Checklist Before Shipping a Mobile Crypto Screen

- [ ] Tested at 375×667 (iPhone SE) — no horizontal overflow
- [ ] Tested at 390×844 (iPhone 14) — canonical target
- [ ] Tested at 430×932 (Pro Max) — nothing stretched ugly
- [ ] All numbers are `tabular-nums`
- [ ] All tappable elements are ≥44×44px
- [ ] No text smaller than 11px
- [ ] No `blur(>12px)` anywhere
- [ ] Day mode overrides present for every custom color
- [ ] Skeletons shimmer during loading, never spinners
- [ ] Color magnitude grading applied to all % values
- [ ] Trade/primary CTA sticky-docked at bottom (if asset page)
- [ ] Pull-to-refresh works on all list screens
- [ ] Long-press actions on any asset row
- [ ] No desktop chart toolbar cruft leaking through
- [ ] No emojis, no "Powered by AI", no gradient hero
- [ ] CoinGecko-style row mess not replicated anywhere
