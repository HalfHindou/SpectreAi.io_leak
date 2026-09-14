# SPECTRE TERMINAL — Build Spec

> This is the single source of truth for building the Spectre AI Trading Terminal. Read this in full before opening any agent file. Agents live in `agents/terminal-*.md` and must be run in the order defined in §8.

---

## 0. BOOT SEQUENCE (mandatory)

Before any agent writes a line of code, open and read in this order:

1. `CLAUDE.md` (repo root)
2. `SPECTRE_DESIGN_LAW.md`
3. `DESIGN_SYSTEM.md`
4. `src/index.css` (the `:root` token variables)
5. `src/icons/spectreIcons.jsx`
6. `src/components/WelcomePage.jsx` + `WelcomePage.css` (visual north star)
7. This file
8. The specific `agents/terminal-*.md` you are executing

If any of the above does not exist in the repo you are working in, STOP and report. Do not fabricate tokens or icons.

---

## 1. WHAT WE ARE BUILDING

A full-page trading terminal at route `/terminal/:chain/:address`. Three-column layout: left sidebar, main content (token header + candlestick chart + transactions table + insight cards), right trade panel.

**Visual reference:** `docs/terminal-mockup.png` (dark and day mode side-by-side).
**Structural reference:** `docs/spectre_ai_trading_terminal_concept.jsx` — structure only, the styling in that file violates design law and must be replaced with Spectre tokens.

**Acceptance test (the build is done when this works):**

```
/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump
```

Loads the MAGA token, renders candles, price, metadata, live transactions, insight cards. All data flows through `spectre-data-api`. No direct Codex/DexScreener calls from the browser.

---

## 2. TECH STACK (NON-NEGOTIABLE)

| Concern | Choice | Why |
|---|---|---|
| Framework | React 18 + Vite 5 | Existing app stack |
| Styling | CSS Modules + design tokens from `:root` | Not Tailwind. Matches rest of app. |
| Charts (candles) | `lightweight-charts` v4 (TradingView) | Canvas, 60fps, 45kb gzipped |
| Sparklines | Inline SVG path | No library needed |
| Tables (virtualized) | `react-window` | Tx table can exceed 10k rows |
| Data fetching | `swr` with custom fetcher | Already in repo, stale-while-revalidate |
| Live data | Native `WebSocket` to spectre-data-api | Not socket.io, not polling |
| Icons | `spectreIcons` from `src/icons/spectreIcons.jsx` | Design law §RULE 0 |
| Fonts | `--font-display` headings, `--font-mono` numbers | Already loaded |
| State (local) | `useState` + `useReducer` | No global store needed for terminal |
| Routing | existing React Router setup | No new routing primitives |

**Banned in this build:** Tailwind, styled-components, Lucide/Heroicons/FontAwesome, emoji as UI, spinners, `polling`, `axios`, `recharts` for the main chart, socket.io.

---

## 3. FILE STRUCTURE

```
src/features/trading-terminal/
├── TradingTerminal.jsx                 # route component
├── TradingTerminal.module.css
├── index.js                            # barrel export
├── components/
│   ├── TerminalHeader.jsx              # top nav + search + wallet chip
│   ├── TerminalHeader.module.css
│   ├── TopMoversRail.jsx               # horizontal ticker under header
│   ├── TopMoversRail.module.css
│   ├── TerminalSidebar.jsx             # left nav: overview/watchlists/chains
│   ├── TerminalSidebar.module.css
│   ├── TokenHeaderCard.jsx             # ticker + price + 5 stat tiles
│   ├── TokenHeaderCard.module.css
│   ├── Chart/
│   │   ├── Chart.jsx                   # lightweight-charts wrapper
│   │   ├── Chart.module.css
│   │   ├── ChartToolbar.jsx            # timeframe + indicators + fullscreen
│   │   └── ChartDrawingRail.jsx        # left-side drawing tools
│   ├── TransactionsTable.jsx           # live trades (virtualized)
│   ├── TransactionsTable.module.css
│   ├── TradePanel.jsx                  # right sidebar: buy/sell/DCA
│   ├── TradePanel.module.css
│   └── insights/
│       ├── SentimentCard.jsx           # circular gauge + volume/liq/holders
│       ├── KeyInsightsCard.jsx         # bulleted AI insights
│       ├── OutlookCard.jsx             # bull/bear + confidence bar
│       └── insights.module.css         # shared
├── hooks/
│   ├── useToken.js                     # metadata + price
│   ├── useOHLCV.js                     # candles + volume, timeframe-aware
│   ├── useTransactions.js              # WebSocket live trades
│   ├── useTopMovers.js                 # global movers rail
│   ├── useTokenInsights.js             # Spectre Brain output
│   └── useWallet.js                    # re-export existing wallet hook
├── api/
│   ├── client.js                       # fetch wrapper → spectre-data-api
│   ├── endpoints.js                    # URL builders
│   └── socket.js                       # WebSocket manager (singleton)
├── lib/
│   ├── formatNumber.js                 # 12842 → "12,842", 48530000 → "$48.53M"
│   ├── formatPrice.js                  # sig-fig aware for meme tokens
│   └── formatDuration.js               # "12s ago"
└── types.js                            # JSDoc typedefs
```

---

## 4. ROUTE + LAYOUT

**Route:** `/terminal/:chain/:address`

`chain` ∈ `sol | eth | base | arb | bnb`.
`address` is the raw token/pair address (no normalization — the API handles it).

**Grid (desktop, ≥1400px):**

```
┌──────────────────────────────────────────────────────────────┐
│                    TerminalHeader (56px)                      │
├──────────────────────────────────────────────────────────────┤
│                    TopMoversRail (48px)                       │
├──────────┬───────────────────────────────────────┬───────────┤
│          │           TokenHeaderCard              │           │
│ Sidebar  ├───────────────────────────────────────┤  Trade    │
│ (220px)  │             Chart (420px tall)         │  Panel    │
│          ├───────────────────────────────────────┤  (320px)  │
│          │         TransactionsTable              │           │
│          ├───────────┬───────────┬───────────────┤           │
│          │ Sentiment │ Insights  │   Outlook     │           │
└──────────┴───────────┴───────────┴───────────────┴───────────┘
```

**Breakpoints:**
- `≥1400px` — full 3-col grid
- `1100-1399px` — trade panel collapses to sticky bottom drawer, chart widens
- `<1100px` — single column, trade panel becomes floating action button opening a sheet

**Container:** `max-width: 1800px`, `padding: 24px`, center-aligned.

---

## 5. COMPONENT SPEC

### 5.1 `TerminalHeader`

Top bar. Logo + brand, primary nav pills, search, notification/settings buttons, wallet chip.

- Logo uses `<SpectreLogo />` from `spectreIcons`. Never an emoji.
- Nav pills: `Markets | Trade | Discover | Analytics | Portfolio | Alerts`. Active pill = `--bg-hover` background, `--text-primary`. Inactive = `--text-tertiary`.
- Search input opens the existing global search modal on focus or `⌘K`.
- Wallet chip shows truncated address + tier badge (500 / 1000 / 7000 $SPECTRE). Reuse existing `useWallet` hook. Never mock this.
- Height: 56px. Glass card treatment per design law §Component Patterns.

### 5.2 `TopMoversRail`

Horizontal scrolling rail. Left pill = label ("Market Movers" with `<SpectreBolt />` icon). Right = "View All" link to `/markets`. Middle = chips for top 8 movers.

- Each chip: token logo (24px, from CDN or DexScreener), symbol, 24h change. Green if positive, red if negative.
- Data from `useTopMovers()`. Refresh every 30s.
- Height: 48px. Overflow scroll-x on narrow widths.

### 5.3 `TerminalSidebar`

Left navigation. Sections: Overview, Watchlists, Discover, Blockchains. Plus a "Spectre Pro" upsell card at the bottom (only if user tier < 7000).

- Section headers: `--text-tertiary`, uppercase, `letter-spacing: 0.22em`, font-size 10px.
- Items: glass button, hover reveals `--bg-hover`. Active state uses `--accent` at 0.2 opacity.
- Watchlist counts come from `useWatchlists()` (existing hook).
- Chain selector sets the current chain context. Icon + name + dot indicator for active.
- Upsell card gradient: `linear-gradient(135deg, rgba(139,92,246,0.30), rgba(99,102,241,0.20), transparent)`. CTA button uses `--accent`.
- Width: 220px. Sticky. Internal scroll if overflow.

### 5.4 `TokenHeaderCard`

First card in main column. Token logo, symbol, base pair, chain, DEX, price, 24h change, 5 stat tiles.

- Logo: 56px rounded 16px. Fallback to generated gradient avatar if no logo URL.
- Symbol: `var(--font-display)`, 32px, `letter-spacing: -0.04em`.
- Price: `var(--font-mono)`, 40px, tabular-nums. Digit-by-digit flip animation on change (see §Performance below).
- 24h change chip: `--bull` / `--bear` at 0.08 bg, matching color text.
- Stat tiles (5): Market Cap, Liquidity, 24h Volume, Holders, FDV. Uppercase labels in `--text-tertiary`. Values in `var(--font-mono)`.
- Verified badge (top-right) if `token.verified === true`.
- No mcap/FDV for unverified tokens under 24h old — show "—" instead of a fake number.

### 5.5 `Chart`

TradingView Lightweight Charts wrapper. Candlestick + volume histogram stacked.

**Implementation rules:**
- Import: `import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'`.
- Chart colors from design tokens, not hard-coded.
  - Up candle: `--bull`
  - Down candle: `--bear`
  - Wick: match body
  - Grid lines: `rgba(255,255,255,0.04)`
  - Crosshair: `rgba(255,255,255,0.24)`
  - Background: transparent (lets card bg show through)
- Price scale: right side, auto, log toggle.
- Time scale: bottom, compact timestamps.
- Subscribe to `chart.timeScale().subscribeVisibleTimeRangeChange` for lazy-loading older candles.
- On timeframe change, dispose and recreate series — do not try to swap data on the same series.
- Resize observer on container → `chart.applyOptions({ width, height })`.

**Toolbar:**
- Timeframes: `1m 5m 15m 1H 4H 1D`. Active = `--bg-hover` pill.
- Indicators dropdown: EMA, RSI, MACD, Bollinger. Phase 2.
- Display dropdown: candles / line / area. Phase 2.
- Icon buttons: screenshot, settings, fullscreen. Use `spectreIcons`.

**Drawing rail (left of chart):** 8 icon buttons. Phase 2 — render as disabled with tooltip "Coming soon".

**OHLC readout:** Above chart. Green if close ≥ open, red otherwise. Monospace.

### 5.6 `TransactionsTable`

Live trades feed. Tabs: Transactions | Holders (count) | Top Traders | Activity | Bubbles. For this build only the Transactions tab renders a real table — others show skeleton placeholder with "Coming soon".

**Table columns:** Time | Type | Price (quote) | Amount (base) | Total (quote) | Maker | Tx

- Virtualized via `react-window` FixedSizeList. Row height 48px.
- New rows prepend with a 200ms `--bull` (if buy) or `--bear` (if sell) flash background, fading to transparent. Use CSS custom property for the animation.
- Maker address: truncated `7xKc...2f4e`, click-to-copy, hover shows full + wallet label if Arkham returns one.
- Tx arrow: link to explorer (`solscan.io/tx/...` for sol, `etherscan.io/tx/...` for eth, etc.).
- Filter button: opens a popover with Buy/Sell toggle, min total, maker search.
- Columns button: show/hide columns, stored in `localStorage` per user.

### 5.7 `TradePanel`

Right sidebar. Two tabs: Trade | Auto Buy. Trade tab is primary for this build. Auto Buy shows "Coming soon" skeleton.

**Trade tab:**
- Buy / Sell segmented control (Buy default, green when active but use `--bull` at 0.15 bg — no solid green gradient, that violates §Design Law).
- Order type: Market | Limit | DCA. Market default.
- "Pay With" input: token selector (SOL by default), balance shown on the right. Large number input, `var(--font-mono)`, 28px.
- Quick amounts: 0.1 | 0.25 | 0.5 | 1 | 2. Segmented pills, active state on tap.
- "Receive" output: computed from price, read-only.
- Details block: Slippage Tolerance (0.5% default, editable), Priority Fee (Auto), Routing (Best Route, uses `--accent` color).
- CTA: `Buy {SYMBOL}` button, full-width, uses `--accent` solid. This is the ONLY solid-purple CTA on the page.
- Below CTA: estimate text `Est. 1 {SYMBOL} ≈ 0.000487 SOL` in `--text-tertiary`.

**Wallet flow:**
- If wallet not connected, CTA becomes `Connect Wallet`, triggers existing `useWallet().connect()`.
- If insufficient balance, CTA becomes disabled with `Insufficient {PAY_TOKEN}`.
- If swap impact >5%, show warning card above CTA in `--bear` tint.

### 5.8 Insights (`SentimentCard` / `KeyInsightsCard` / `OutlookCard`)

Three equal-width cards below the transactions table. Data from `useTokenInsights()` which calls Spectre Brain.

**`SentimentCard`:**
- Circular gauge, 80px, stroke 4px. Fill = sentiment score 0-100.
- Gradient stops: `--bear → --text-muted → --bull` across 0/50/100.
- Below gauge: 3 mini-tiles for Volume (24h delta), Liquidity (stable/growing/declining), Holders (24h delta).

**`KeyInsightsCard`:**
- 3 insight rows. Each: 8px colored dot + title + 1-line description.
- Dot colors are semantic (`--bull` positive signal, `--bear` risk, `--accent` neutral/informational).
- Source: `spectre_brain_signals` MCP output (already live).

**`OutlookCard`:**
- Header: "AI Outlook" + timeframe label ("Short-term").
- Verdict: `Bullish | Bearish | Neutral`, `var(--font-display)`, 24px. Colored by `--bull` / `--bear` / `--text-secondary`.
- Mini bar chart (8 bars, 14px tall container), last 8 candles' delta direction.
- Confidence bar: horizontal 0-100%, gradient `--bear → --accent → --bull`.
- Footnote: "AI analysis is not financial advice." in `--text-muted`.

---

## 6. DATA CONTRACT

All data flows through `spectre-data-api`. No direct third-party calls from the browser.

**Base URL:** `https://api.spectreai.io` (or `VITE_SPECTRE_API` env). Proxied through Cloudflare.

**Auth:** existing Bearer token from `useAuth()`. Attach via `api/client.js` interceptor.

### HTTP endpoints

| Hook | Method | Endpoint | Returns |
|---|---|---|---|
| `useToken` | GET | `/v1/token/:chain/:address` | `{ symbol, name, logo, price, priceChange24h, mcap, fdv, liquidity, volume24h, holders, verified, pair, dex }` |
| `useOHLCV` | GET | `/v1/token/:chain/:address/ohlcv?tf=1h&limit=500&before=<ts>` | `{ candles: [{ t, o, h, l, c, v }] }` |
| `useTopMovers` | GET | `/v1/markets/movers?chain=:chain&limit=8` | `{ movers: [{ symbol, address, change24h, logo }] }` |
| `useTokenInsights` | GET | `/v1/token/:chain/:address/insights` | `{ sentiment, signals, outlook, confidence, volumeDelta, liquidityStatus, holdersDelta }` |

### WebSocket

**URL:** `wss://api.spectreai.io/v1/stream`

**Subscribe message:**
```json
{ "action": "subscribe", "channels": ["price:sol:<addr>", "trades:sol:<addr>"] }
```

**Price tick event:**
```json
{ "channel": "price:sol:<addr>", "t": 1724567890, "price": 0.04859, "change24h": 0.0642 }
```

**Trade event:**
```json
{ "channel": "trades:sol:<addr>", "t": 1724567890, "type": "buy", "price": 0.04859, "amount": 1248.37, "total": 60.68, "maker": "7xKc...2f4e", "tx": "..." }
```

**Reconnect strategy:** exponential backoff 1s → 2s → 4s → 8s → 16s cap. Resubscribe on reconnect.

### Missing endpoints — how to respond

If any endpoint above returns 404, the data-layer agent must:
1. Log a `console.warn` with the missing endpoint.
2. Return a stable mock from `api/mocks/` so the UI still renders.
3. Add an entry to `docs/TERMINAL_API_GAPS.md` listing the missing endpoint + what it needs.
4. Never fabricate numbers inline in the component.

---

## 7. PERFORMANCE BUDGETS

| Metric | Budget | How |
|---|---|---|
| JS bundle (terminal route) | <180kb gzipped | Route-level code split, dynamic import `lightweight-charts` |
| Time to interactive | <1.5s on fast connection | Skeleton shimmer on mount, data streams in |
| Chart first frame | <400ms after OHLCV arrives | Render skeleton OHLC bars while fetch resolves |
| Candle update | 60fps during live stream | Batch ticks through `requestAnimationFrame` |
| Transaction row insert | <16ms | Virtualized list, prepend with CSS-only flash |
| Price digit flip | 180ms ease-out per changed digit | Use per-digit components with `key={price}` |

**Techniques (apply where relevant):**
- `React.memo` on `TransactionRow`, `MoverChip`, `SidebarItem`.
- `useDeferredValue` for search input.
- WebSocket events → internal buffer → flush on rAF. Never `setState` on every tick.
- Preload the chart chunk on route hover via `<link rel="modulepreload">`.
- `IntersectionObserver` to pause updates when tab/chart is off-screen.

---

## 8. AGENT EXECUTION PLAN

Six agents. Run in parallel Claude Code terminals with the gates below. Launch with `claude --dangerously-skip-permissions`. Agents only write inside their owned paths (§3). If an agent needs to read another agent's file, it reads but does not edit.

### Gate A (run in parallel, no dependencies)

- **`agents/terminal-shell.md`** — route, layout grid, header, sidebar, top movers rail. Owns the skeleton. Uses mock data for movers and sidebar counts.
- **`agents/terminal-data-layer.md`** — `api/`, `hooks/`, mocks, WebSocket singleton. No UI. Exports typed hooks.

**Gate A passes when:** both agents report their components/hooks render with mock data and expose the documented prop/return shapes.

### Gate B (run in parallel, requires Gate A)

- **`agents/terminal-chart.md`** — `Chart/` folder. Consumes `useOHLCV`.
- **`agents/terminal-transactions.md`** — `TransactionsTable.jsx`. Consumes `useTransactions`.
- **`agents/terminal-trade-panel.md`** — `TradePanel.jsx`. Consumes `useToken`, `useWallet`.
- **`agents/terminal-insights.md`** — `insights/` folder. Consumes `useTokenInsights`.

**Gate B passes when:** all four feature components render in isolation via Storybook or a route stub, hooked to hooks from Gate A.

### Gate C (serial, one terminal, you drive)

Integration pass. Wire everything into `TradingTerminal.jsx`, test the MAGA acceptance route, fix any mismatches. Take the day-mode tokens from `SPECTRE_DESIGN_LAW.md` §Day Mode Creativity and verify every component honors `.app.app-day-mode`.

### Existence check (every agent, before writing anything)

Each agent's first step is:
```bash
ls src/features/trading-terminal/ 2>/dev/null || echo "not yet created"
```
If any file the agent is about to create already exists, STOP and report. Do not overwrite. Per the Brain backend incident memory, parallel agents without existence checks destroyed three files last time.

---

## 9. ACCEPTANCE TESTS

These must pass before Gate C is considered complete:

1. **MAGA loads:** `/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump` renders all components with real data. Chart shows candles. Transactions stream.
2. **Timeframe switch:** Clicking `1m / 5m / 15m / 1H / 4H / 1D` refetches OHLCV and re-renders chart within 400ms.
3. **Wallet connect:** Connect wallet button triggers existing modal. Address + tier appear in header.
4. **Day mode toggle:** Existing theme toggle switches every component. No hard-coded dark colors anywhere.
5. **Mobile:** At 375px width, layout collapses to single column. Trade panel becomes a floating CTA that opens a sheet.
6. **Reconnect:** Kill WebSocket in DevTools → see "reconnecting" indicator in table header → reconnects within 16s.
7. **No emojis in rendered DOM.** Grep check: `rg -n '[\x{1F300}-\x{1FAFF}]' src/features/trading-terminal/` returns nothing.
8. **No Tailwind classes.** Grep check: `rg -n 'className=".*\bbg-\[' src/features/trading-terminal/` returns nothing.
9. **Performance:** Lighthouse score ≥90 on the terminal route.
10. **Lint + build:** `npm run lint && npm run build` clean.

---

## 10. OUT OF SCOPE FOR THIS BUILD

- Auth, wallet connect internals (use existing).
- Global search backend (use existing).
- Settings page (use existing).
- Indicator calculations (EMA/RSI/MACD) — stub the dropdown, Phase 2.
- Limit + DCA order logic — UI only, submit disabled.
- Holders / Top Traders / Activity / Bubbles tabs on the transactions table — tab headers render, body shows "Coming soon" skeleton.
- Mobile app packaging — the route must be responsive, but Capacitor wrap is a separate workstream.

---

## 11. KNOWN DEPENDENCIES + ISSUES

- **Codex 402:** Codex GraphQL returns 402 until billing is resolved in the dashboard. Until fixed, `useOHLCV` should fall back to DexScreener candle endpoint (which the data-layer agent wires internally in `spectre-data-api`, not the browser).
- **MCP brain tools:** `spectre_brain_state`, `spectre_brain_signals`, `spectre_brain_narratives`, `spectre_brain_conviction_history` are live. The `/v1/token/.../insights` endpoint should call these server-side and shape the response per §6.
- **BRIDGE.md pattern:** If the insights endpoint needs per-feature fallback, add a flag there. Never flip `USE_SPECTRE_API` globally.
- **ioredis syntax reminder:** If the data-layer backend needs Redis caching for OHLCV, positional args: `EX, 120` not `{EX: 120}`.
- **Vercel double-build:** If CI fires twice, add an ignored build step filter for `src/features/trading-terminal/**`.
- **Husky in CI:** existing `husky || true` handles this.

---

## 12. COPY STANDARDS (for any user-facing text)

Per the broader Spectre voice rules:
- No em dashes.
- No "Not X, but Y" constructions.
- Short declarative sentences.
- Numbers carry the weight. No adjectives like "powerful" or "revolutionary".
- Never say "AI" in user-facing copy except on the `AI Outlook` card title (already established surface) and the `Spectre AI Insights` card title. Intelligence is invisible elsewhere.
- Disclaimers in `--text-muted`, small font. Factual.

---

## 13. WHEN YOU HIT SOMETHING UNCLEAR

Stop. Write a one-line question in `docs/TERMINAL_BUILD_QUESTIONS.md`. Do not guess. Do not improvise. Do not fabricate an endpoint, stat, or data shape that isn't documented here.
