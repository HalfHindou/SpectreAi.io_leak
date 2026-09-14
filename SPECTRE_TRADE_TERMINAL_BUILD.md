# SPECTRE AI — TRADING TERMINAL BUILD

> Single-shot mega-brief for Claude Code. Build a pro trading terminal in `apps/research` at route `/trade`. Match the attached visual (two-panel + chart + order ticket + insights row) while translating every Tailwind class from the concept file to Spectre's native design tokens. No Tailwind, no TypeScript in app code, no emojis, no purple chrome, no "AI" badges.
>
> **Reference concept (design only, not copyable code):** `/Users/sunny/Downloads/spectre_ai_trading_terminal_concept.jsx`
> **Target app:** `apps/research` (React 18 + Vite + plain CSS, port 5180)
> **Nav integration:** add under existing "Trading" category in `src/components/navigation-sidebar.jsx`
> **Smoke-test token:** MAGA on Solana → `Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump` (networkId `1399811149`)

---

## 0. Hard Constraints (read before opening any file)

Follow `.claude/rules/design-system.md`, `.claude/rules/coding-standards.md`, `.claude/rules/charts-system.md`, `apps/research/CLAUDE.md`. In particular:

- **JSX + plain CSS only.** `.jsx` / `.js` / `.css`. No TypeScript in app code. The concept file is `.jsx` with TS types — that's reference, not the contract.
- **No Tailwind.** Every utility class in the concept maps to a CSS custom property or a class in your paired `.css`. Target visual parity, not DOM parity.
- **Warm-white accent only.** The concept leans purple/violet — strip it. Use `var(--accent)` (#f5f5f7), `var(--bull)` / `var(--bear)` for P&L, never purple chrome. Violet (`--violet`) is reserved for EUPHORIA market state only.
- **No emojis as UI.** 🐸 👻 ⚡ 📷 ⤢ — all must become `spectreIcons` SVGs from `src/icons/`. Token logos come from CoinGecko / Codex metadata, never hardcoded.
- **No "Spectre AI Insights" beta badge, no "AI analysis is not financial advice" small-print boilerplate, no brain/sparkle icons.** Intelligence is invisible. The insights row must look like a broker's research panel, not an AI demo.
- **Numbers in `var(--font-mono)` (JetBrains Mono).** Always. Prices, volumes, balances, percentages, tx counts, wallet shorthand.
- **Shimmer skeletons, never spinners.** Every async panel ships with a skeleton that matches its final shape.
- **Day mode + mobile splits are mandatory.** One `.css`, one `.day-mode.css`, one `.mobile.css`. Do not ship dark-only.
- **Non-custodial.** No private keys on any server route. Swap execution goes through the existing Privy + trading-app iframe pattern (see `apps/research/CLAUDE.md` → "Token Page Architecture"). For v1 of the terminal, the Buy/Sell ticket **posts intents to the existing swap pipeline** — do not re-implement signing.
- **Reuse over reinvent.** `TradingViewAdvanced.jsx`, `useCodexData`, `codexApi`, `codexAdapter`, `spectreIcons`, `useCurrency` already exist. Use them.

---

## 1. Mission (one paragraph)

Ship a desktop-first trading terminal page at `/trade` that loads any Codex-indexed token in under 2 seconds, renders a professional candlestick chart with live trades streaming, a market-order ticket panel on the right, a transactions / holders / top-traders tab bar under the chart, and a three-card insights row at the bottom. Wire it to the existing Codex GraphQL pipeline. Keep the visual calm, monospace, warm-white — it should feel like Bloomberg ran through Apple's design team, not like a memecoin dashboard.

---

## 2. Routing & Nav Integration

### 2.1 Route ID + Path

Add to `apps/research/src/constants/pageRoutes.js`:

```js
// In PAGE_PATHS map
'trade': '/trade',
```

Support two URL shapes via one route:

```
/trade                                     → default (last-viewed token or BTC)
/trade/:network/:address                   → explicit token (preferred)
/trade?symbol=BTC                          → legacy shortcut for majors
```

Where `:network` is one of `solana | ethereum | base | arbitrum | bnb` (map internally to Codex networkId: Solana=1399811149, Ethereum=1, Base=8453, Arbitrum=42161, BNB=56).

### 2.2 App.jsx Route

Add under AppShell + PageShell (standard tier 3 — see `coding-standards.md` → Routing). Lazy-loaded with `Suspense fallback={null}`. Wrap in `<PageErrorBoundary>`.

```jsx
const TradePage = lazy(() => import('@/pages/trade'))
// ...
<Route path="/trade" element={<PageErrorBoundary><TradePage /></PageErrorBoundary>} />
<Route path="/trade/:network/:address" element={<PageErrorBoundary><TradePage /></PageErrorBoundary>} />
```

### 2.3 Sidebar Entry

In `apps/research/src/components/navigation-sidebar.jsx` → `navigationCategories` → the `trading` category, **insert at position 0** (above Trader's Corner):

```js
{ id: 'trade', label: 'Terminal', badge: 'NEW' },
```

Then add an icon case for `'trade'` in the same file's icon switch (alongside `'research-zone'`, `'lens'`, etc.). Use a clean 20×20 SVG from `spectreIcons` — pick the closest candlestick / chart glyph or author a new one in `src/icons/spectreIcons.jsx` if none fits (1-stroke, 1.5px, rounded caps, matches the existing set).

Also add the translation key `nav.terminal = 'Terminal'` to all 8 locale files under `src/i18n/locales/*.json`. Keep the English label "Terminal" — short, no emoji, no "AI".

### 2.4 Deep-link from token pages

In `apps/research/src/pages/token/components/*` and `research-zone` token cards, add a "Trade" action that navigates to `/trade/${network}/${address}`. This is a *secondary* task — ship the page first, deep-link second.

---

## 3. Page File Layout

```
apps/research/src/pages/trade/
  index.jsx                       # Thin wrapper: reads URL params, pulls store/context, passes flat props
  components/
    trade.jsx                     # Top-level layout (3-col grid: sidebar-content-ticket)
    trade.css                     # Dark styles (default)
    trade.day-mode.css            # Day mode overrides
    trade.mobile.css              # Mobile layout (single column, ticket as bottom sheet)

    # Left
    trade-left-rail.jsx           # Overview / Markets / Watchlists / Discover / Blockchains / upgrade card
    trade-left-rail.css

    # Top
    trade-movers-rail.jsx         # Horizontal ticker of top movers (marquee with pause-on-hover)
    trade-movers-rail.css

    # Center top
    trade-token-header.jsx        # Logo + pair + price + 24h change + 5-stat strip (MCap / Liq / 24h Vol / Holders / FDV)
    trade-token-header.css

    trade-chart.jsx               # TradingViewAdvanced wrapper w/ integrated toolbar
    trade-chart.css

    # Center bottom
    trade-data-tabs.jsx           # Tab bar: Transactions | Holders | Top Traders | Activity | Bubbles
    trade-data-tabs.css
    trade-transactions-table.jsx  # Live trades table
    trade-holders-table.jsx       # Holder distribution table
    trade-top-traders-table.jsx   # PnL-ranked wallets
    trade-activity-feed.jsx       # Unified feed (mints/burns/transfers)
    trade-bubbles-view.jsx        # Lazy-loaded; reuses existing bubbles canvas

    # Right
    trade-ticket.jsx              # Order ticket (Buy/Sell, Market/Limit/DCA, pay/receive inputs, slippage, routing)
    trade-ticket.css
    trade-token-card.jsx          # Compact right-side token summary card
    trade-token-card.css

    # Bottom
    trade-insights-row.jsx        # 3-card grid: Sentiment, Key Signals, Outlook
    trade-insights-row.css

    # Hooks
    use-trade-token.js            # Resolves URL → {networkId, address, symbol, metadata}; exposes { token, loading, error }
    use-trade-trades.js           # Subscribes to live trade events (Codex subscription or 3s poll fallback)
    use-trade-holders.js
    use-trade-top-traders.js
    use-trade-insights.js         # Derived signals (no "AI" wording in the hook surface)

    # Constants
    trade-constants.js            # NETWORK_SLUG_TO_ID, DEFAULT_TOKEN, TIMEFRAMES, TICKET_PRESETS
```

**Rule:** `index.jsx` has ZERO JSX — it only reads URL params + stores and passes flat props into `<Trade />`. All UI lives under `components/`. Page-specific constants stay in `components/trade-constants.js`, not `src/constants/`.

---

## 4. Visual Translation Table (Tailwind concept → Spectre tokens)

Work through the concept file and replace every Tailwind class. The table below is the map — apply it consistently.

| Concept (Tailwind) | Spectre equivalent |
|---|---|
| `bg-[#0b1120]/90 backdrop-blur-xl` window shell | `.glass` (var(--glass-bg) + blur 24px + saturate(180%)) |
| `border-white/10` panel border | `1px solid var(--glass-border)` |
| `rounded-[34px]` outer shell | `border-radius: var(--radius-2xl)` (32px) — the extra 2px isn't worth a custom token |
| `rounded-[26px]` inner panels | `border-radius: var(--radius-xl)` (24px) |
| `rounded-2xl` controls | `border-radius: var(--radius-md)` (12px) |
| `rounded-full` pills | `border-radius: var(--radius-full)` |
| `bg-[radial-gradient(circle_at_top,_rgba(109,70,255,0.18),...)]` page bg | **Drop the purple.** Use `background: var(--bg-void);` period. The page bg is plain black. |
| `from-[#6b7cff] via-[#8d63ff] to-[#72e6a6]` accent gradient | **Drop.** Buy primary = `var(--accent-gradient)` (warm-white on black). |
| `bg-gradient-to-r from-[#6f82ff] via-[#876fff] to-[#77e6a6]` Buy button | **Single-color.** Bull primary = `background: var(--bull); color: #0a0a0a;` on Buy only. The CTA is the single piece of chromatic saturation allowed. |
| `text-emerald-300/400` pos / `text-rose-300/500` neg | `color: var(--bull-bright)` / `color: var(--bear-bright)` |
| `bg-emerald-500/15` Buy hover tint | `background: var(--bull-muted)` |
| `text-violet-400` active tab text | `color: var(--text-primary)` + thin bottom indicator using `var(--accent)` |
| `bg-violet-500/20 text-violet-300` active sidebar item | `background: var(--glass-bg-light); color: var(--text-primary);` + 1px inset border `rgba(255,255,255,0.06)` |
| `shadow-[0_30px_120px_rgba(0,0,0,0.45)]` window shadow | `box-shadow: var(--shadow-xl)` |
| Emoji 🐸 token placeholder | Token logo `<img>` from `token.info.imageLargeUrl` (Codex) or CoinGecko; fallback = circle with initial + color from `tokenColors.js` |
| Emoji 👻 brand mark | `spectreIcons.Spectre` (the app logo used in header already) |
| Emoji ⚡ "Market Movers" pill icon | `spectreIcons.Bolt` or similar; fall back to **no icon** if none fits — a pure-text label is better than a wrong glyph |
| Emoji 🔔 ⚙️ header icons | `spectreIcons.Bell`, `spectreIcons.Settings` |
| Emoji 📷 ⤢ chart toolbar icons | `spectreIcons.Camera`, `spectreIcons.Expand` (add to spectreIcons if missing) |
| `font-semibold tracking-tight` prices | `font-family: var(--font-mono); font-weight: 600; letter-spacing: -0.01em;` |
| `text-xs uppercase tracking-[0.16em]` labels | `.caption` class from `index.css` |

Concept's "Night Mode / Day Mode" side-by-side is design-review only. Ship one page that responds to `useSettingsStore((s) => s.dayMode)` — same DOM, different stylesheet class.

---

## 5. Layout

### 5.1 Desktop (≥1280px)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [existing NavigationSidebar]    [existing Header: search + profile]    │
├────────────┬────────────────────────────────────────────┬──────────────┤
│            │  [ Movers Rail — marquee, full width ]     │              │
│            │ ┌───────────────────────────────────────┐  │ ┌──────────┐ │
│ Left rail  │ │ Token Header (logo + price + stats)   │  │ │ Token    │ │
│ (sticky    │ ├───────────────────────────────────────┤  │ │ Card     │ │
│  220px)    │ │ Chart Toolbar                         │  │ └──────────┘ │
│            │ │ Chart (TradingViewAdvanced, ~420px)   │  │ ┌──────────┐ │
│            │ ├───────────────────────────────────────┤  │ │ Ticket   │ │
│            │ │ Data Tabs + Table                     │  │ │ (Buy/    │ │
│            │ ├───────────────────────────────────────┤  │ │  Sell)   │ │
│            │ │ Insights Row (3 cards)                │  │ │          │ │
│            │ └───────────────────────────────────────┘  │ └──────────┘ │
└────────────┴────────────────────────────────────────────┴──────────────┘
```

Grid: `grid-template-columns: 220px minmax(0, 1fr) 340px; gap: var(--sp-4);`

The existing `NavigationSidebar` is the **app-level** nav — the terminal's "Left rail" from the concept is a **page-scoped second rail** (Overview / Watchlists / Discover / Blockchains + upgrade card). Keep both. Page rail sits inside `<PageShell>`, app rail sits outside.

If this creates visual density on <1440px screens, **collapse the page-scoped left rail into icon-only mode** at 1280–1440px, same pattern as `navSidebarCollapsed` in `app-shell.jsx`.

### 5.2 Tablet (768–1279px)

- App nav: collapsed to icons.
- Page left rail: hidden; its Blockchains section becomes a horizontal chip row above the Movers Rail.
- Ticket: moves from right column to a **floating action button** ("Trade") that opens a right-side drawer on click.

### 5.3 Mobile (<768px)

- Single column.
- Order of sections: Movers → Header → Chart (300px tall) → Tabs → Insights.
- Ticket opens as a **bottom sheet** from the existing mobile bottom nav pattern (see `src/components/mobile-bottom-nav.jsx`). The Buy CTA floats above the bottom nav, tap opens the sheet.
- Chart toolbar collapses into a single settings button; timeframes become a horizontal scroll row.

---

## 6. Data Contract (Codex GraphQL)

Everything goes through the existing server proxy: `POST /api/codex { action, ...params }`. The server already wraps the Codex API key. See `packages/server/` and `apps/research/src/services/codexApi.js`. Extend, do not duplicate.

### 6.1 Token metadata — `useTradeToken({ network, address })`

```
Codex query: token(input: { address, networkId })
Return: { id, address, networkId, symbol, name, decimals,
          info: { imageLargeUrl, circulatingSupply, ... },
          exchanges, socialLinks }
```

Then `pairMetadata(input: { pairId })` for the top pair to get `liquidity`, `volume24`, `priceUsd`, `priceChange24`, `marketCap`, `fdv`.

Cache in Zustand `useTradeStore` by `${networkId}:${address}` for 60s.

### 6.2 Chart bars — reuse `useChartData` / `codexAdapter`

Feed `TradingViewAdvanced` the same datafeed it already uses. Do NOT build a new one. Pass `address` + `networkId` as symbol info. Let Phase 1 of the charts upgrade plan (see `charts-system.md` §F) handle outlier filtering — the terminal inherits those fixes automatically.

Timeframes to support: `1m, 5m, 15m, 1H, 4H, 1D`. Default: `1H`. Persist last-used timeframe per token in `useTradeStore`.

### 6.3 Live trades — `useTradeTrades({ pairId })`

Preferred: Codex subscription `onTokenEventsCreated(input: { networkId, tokenAddress })`. Server-side subscription proxy may not exist yet — if not, **do not build it in v1**. Fall back to polling `getTokenEvents` every 3s with `document.hidden` guard (pattern in `.claude/rules/coding-standards.md` §H).

Return: `{ trades: TradeRow[], loading, error }` where
```js
TradeRow = { ts, type: 'Buy' | 'Sell', priceSol, priceUsd, amountToken, totalSol, totalUsd, maker, txHash }
```

Render newest at top, cap at 200 rows (virtualized — use existing table virtualization if any page has it, otherwise plain `.slice(0, 200)`).

Flash new rows with a 400ms `--bull-muted` / `--bear-muted` row background animation. One single `keyframes tradeFlash` definition.

### 6.4 Holders — `useTradeHolders({ networkId, address })`

Codex `holders(input: { tokenId: "$address:$networkId", cursor, limit: 50 })` → paginated. Columns: rank, wallet (shortened), balance, % of supply, value USD, first seen.

### 6.5 Top Traders — `useTradeTopTraders({ pairId })`

Codex `topTraders(pairId: $pairId, timeRange: DAY_1)` → columns: wallet, PnL USD, PnL %, trades, volume. Badge "Whale" if balance > 1% of supply.

### 6.6 Token Movers — `useTradeMovers({ networkId })`

Codex `listTopTokens(networkFilter: $networkId, resolution: "1h", limit: 12)` on 30s refresh. Same polling guard.

---

## 7. Order Ticket (right panel)

This is the highest-stakes surface. Build it exactly once, correctly.

### 7.1 States

```
[Trade] [Auto Buy]   ← tab segment (Auto Buy is v1.5 — stub with disabled state + "Coming soon" caption)

[Buy] [Sell]         ← side selector (Buy = var(--bull-muted) bg when active, Sell = var(--bear-muted))
[Market] [Limit] [DCA]  ← order type tabs (v1 ships Market; Limit & DCA render disabled + caption)

Pay With: [amount input]  [token selector]
          [0.1] [0.25] [0.5] [1] [2]   ← quick-fill pills (% of balance for buy, % of position for sell)

Receive: [computed amount]  [token pill]

Slippage Tolerance: 0.5%       ← click to edit (popover: 0.1 / 0.5 / 1.0 / Custom)
Priority Fee:       Auto (0.001 SOL)   ← click to edit
Routing:            Best Route         ← click opens route breakdown tooltip

[Buy MAGA] ← primary CTA, full-width, var(--bull) on bull side / var(--bear) on sell side
            disabled if amount <= 0 OR wallet not connected OR balance < amount
Est. 1 MAGA ≈ 0.000487 SOL   ← caption below CTA
```

### 7.2 Wiring

- Balance source: existing `useWalletBalances` hook.
- Quote source: reuse the swap quote pipeline from `apps/trading` (the trading app is authoritative for swap UI). v1 posts the intent to `/api/swap/quote` (if it exists) or opens the token page's swap iframe prefilled with `?buy=$address&amount=$amount`. Non-custodial rule: the actual transaction signs in the existing Privy wallet flow.
- Connect state: if no wallet, CTA label becomes "Connect Wallet" and invokes existing Privy connect modal.
- Errors: inline under the CTA (single line, `var(--bear)` text, no toast for validation errors — toasts are for post-submit outcomes).

### 7.3 Visual spec

- Ticket background: `.glass` with `--radius-xl`, inner padding `var(--sp-4)`.
- Amount input: `var(--font-mono)`, 32px, weight 600, letter-spacing -0.02em. Placeholder `0`. No spinner arrows.
- Quick-fill pills: `var(--glass-bg-light)` bg, active pill = `var(--bg-elevated)` + `var(--text-primary)`, others `var(--text-tertiary)`.
- CTA: 52px height, `border-radius: var(--radius-lg)`, no gradient, single `var(--bull)` or `var(--bear)` bg, text black, `font-weight: 600`, `font-size: 1rem`. Hover: brightness(1.05). Active: `translateY(0)`.

---

## 8. Insights Row (bottom)

Three cards. **Do not label this "Spectre AI Insights".** Section heading: "Signals" (or drop the heading entirely and just render the three cards).

### 8.1 Card A — Sentiment

- Donut ring (SVG, stroke 4px, warm-white gradient on `--bull` → `--accent`). Value centered, mono, weight 600, 24px.
- Subtext one line: "Sentiment neutral · volume +18.7% 24h".
- Three stat tiles under: Volume / Liquidity / Holders with 24h delta.

### 8.2 Card B — Key Signals

- Bulleted list of up to 3 auto-generated signals:
  - `Whale accumulation — 3 wallets +2.4% supply / 1h`
  - `Liquidity healthy — $6.24M, 0.5% slippage @ 1 SOL`
  - `Social momentum rising — mentions +34% / 24h`
- Dot prefix colored by severity: `--bull` for constructive, `--amber` for caution, `--bear` for warning. Never purple.
- Each row has a tiny source pill on the right (right-aligned): `Chain`, `DEX`, `Social`. `--bg-elevated` bg, `--text-tertiary` text.

### 8.3 Card C — Outlook

- One-word read: `Bullish` / `Neutral` / `Bearish` — colored by read. 24px, weight 600. No "AI" qualifier.
- 8-bar micro-histogram (no axis labels — decorative).
- "Confidence 72%" row → horizontal progress bar using `var(--accent)` (NOT purple gradient).
- Omit the "AI analysis is not financial advice" line from the concept. If legal requires disclosure, put one line in page footer, `.caption`, `--text-muted`.

### 8.4 Rule

If a signal can't be computed with real data, **hide the row**. Do not render placeholder copy. An empty Key Signals card shows a single caption: "No signals in the last hour." Empty is better than fake.

---

## 9. State Model

New Zustand slice at `apps/research/src/store/useTradeStore.js`, persisted to `spectre-trade` localStorage key.

```js
{
  lastToken: { network, address, symbol } | null,
  timeframe: '1H',
  chartType: 'candles',   // 'candles' | 'line' | 'area'
  indicators: string[],    // persisted indicator ids
  side: 'buy' | 'sell',
  orderType: 'market',     // market | limit | dca (limit/dca disabled v1)
  slippageBps: 50,
  priorityFee: 'auto',     // 'auto' | number (lamports)
  recentTokens: Token[],   // last 10 viewed in terminal, unique
}
```

Page reads via selectors: `useTradeStore((s) => s.timeframe)` — never full-store reads.

---

## 10. Performance Rules

- Chart must paint the first batch of bars in **≤1 frame after mount**. Use the charts-system.md P0 fix (immediate first batch, background prefetch) — if it's not yet shipped, the terminal is blocked on Phase 1 of that plan. Call out the dependency rather than working around it.
- Transactions table: virtualize above 100 rows. Use a plain window of 50 rendered rows with `transform: translateY()` scroll positioning.
- Holders / Top Traders tables: paginate client-side in chunks of 50. No infinite scroll in v1.
- Movers Rail: `will-change: transform` on the marquee track, pause animation on `:hover`, pause when `document.hidden`.
- Every hook honors `document.hidden` and clears intervals on unmount.
- `React.memo` the insight cards and the table row component — they re-render on every trade tick otherwise.

---

## 11. Smoke Test — MAGA Token

The build is done when all of these pass, in this order, against `/trade/solana/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump`:

1. Page paints skeleton in <200ms.
2. Token header populates (symbol "MAGA", name, image, 5-stat strip) in <1.5s.
3. Chart renders candles for 1H timeframe, no spikes, zoom + pan work, crosshair readout is mono.
4. Transactions tab streams new buys/sells with flash highlight. No >1s gap between paint and first row.
5. Holders tab loads top 50, sorted by balance desc, wallet addresses short-formatted.
6. Top Traders tab loads 24h rank with PnL colored correctly.
7. Insights row populates at least Card A (sentiment) with real numbers — Cards B/C degrade gracefully if data is sparse.
8. Ticket: entering `0.5` SOL shows correct receive estimate within 500ms. CTA label is "Buy MAGA", disabled until wallet connects.
9. Toggle day mode: every surface flips, numbers stay mono, no broken contrast.
10. Resize to 390px width: layout collapses to single column with bottom-sheet ticket; chart height adapts; no horizontal scroll anywhere on the page.
11. Lighthouse perf ≥85 on /trade (desktop profile, throttled fast 3G, no cache).
12. `npm run build:research` clean. `preview_console_logs level: 'error'` clean.

Also manually verify:
- `/trade/ethereum/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (USDC) renders without crashing even though it's a stable (chart flatlines; insights may be empty — that's fine).
- `/trade?symbol=BTC` resolves to BTC on a major pair via `majorTokens.js` lookup.
- `/trade` (no params) opens `lastToken` from store, or BTC if none.

---

## 12. Agent Swarm

Run Claude Code with the Jarvis orchestrator (`/spectre-work add trade terminal at /trade`). Spawn the following specialists **in parallel** — they have no cross-dependencies once this doc is the shared contract:

### A. Designer Agent → `senior-designer` / `figma-creative-director`
**Scope:** Produce final CSS for `trade.css`, `trade.day-mode.css`, `trade.mobile.css`, all sub-component CSS files. Walk every class name against `.claude/rules/design-system.md` and the Visual Translation Table above. Audit for emojis, purple chrome, bright gradients, "AI" badges — report and strip.
**Output:** PR-ready CSS, plus a 10-item design-review checklist per component.

### B. Data Agent → `general-purpose`
**Scope:** Build `services/` and `hooks/` wiring: extend `codexApi.js` with `getTokenEvents`, `getHolders`, `getTopTraders`, `listTopTokens` if not already present. Implement `use-trade-token`, `use-trade-trades` (sub + poll fallback), `use-trade-holders`, `use-trade-top-traders`, `use-trade-insights`. Honor `document.hidden`. Plain object returns.
**Output:** All hooks + a `docs/trade-data-contract.md` mapping each hook to the exact Codex query it runs.

### C. Chart Agent → `general-purpose` scoped to `charts-system.md`
**Scope:** Wrap `TradingViewAdvanced.jsx` into `trade-chart.jsx`. Do **not** branch or fork the component — wrap and configure. Hook up custom toolbar (timeframes, indicator picker, screenshot, fullscreen). Ensure day mode is honored via the existing `TradingView` theme props.
**Output:** Working chart at /trade, toolbar functional, fullscreen toggles the chart to 100vh inside a portal.

### D. Ticket Agent → `general-purpose`
**Scope:** Build `trade-ticket.jsx` per §7. Wire to `useWalletBalances`, existing Privy connect modal, and the existing swap quote endpoint (or prefilled iframe fallback). Comprehensive disabled-state matrix. No custodial key handling.
**Output:** Ticket that can quote and route an intent for MAGA on Solana, with a 10-state screenshot sheet (connect/no balance/low balance/valid/invalid/success/error/limit-disabled/dca-disabled/day-mode).

### E. Nav Agent → `general-purpose`
**Scope:** Update `navigation-sidebar.jsx`, `pageRoutes.js`, `App.jsx`, all 8 `i18n/locales/*.json` files. Add `spectreIcons.Terminal` (or chosen glyph) to `spectreIcons.jsx`. Add `/trade/:network/:address` route. Deep-link from token pages.
**Output:** Nav diff + routes, plus visual confirmation that the new item renders with icon in both expanded + collapsed sidebar states.

### F. QA Agent → `general-purpose` running `/review` + `/verify` twice (before and after Ticket agent merges)
**Scope:** Run the §11 smoke test checklist. Capture screenshots at 1920 / 1440 / 1024 / 768 / 390 widths in both dark + day modes. File defects with file:line references.
**Output:** `REVIEW_TRADE_TERMINAL.md` with pass/fail per checklist item.

**Coordination rule:** Agents A/B/C/D/E run in parallel. F runs last, twice. No agent invents a design token, icon, or API that isn't in this doc or already in the repo.

---

## 13. Phase-by-phase execution

### Phase 1 — Scaffolding (1 session, solo)
- Create `src/pages/trade/` folder + files (all stubs).
- Add route, nav entry, page ID, i18n keys.
- Page renders a skeleton that lays out the grid with empty panels. No data.
- `npm run build:research` clean. Commit.

### Phase 2 — Data wiring (Data Agent in parallel with Phase 3)
- Extend `codexApi.js`. Build all `use-*` hooks. Hook up `useTradeToken` so the token header populates when you visit `/trade/solana/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump`.

### Phase 3 — Visual (Designer Agent)
- Full CSS pass. Strip purple. Apply day + mobile variants.

### Phase 4 — Chart (Chart Agent)
- `trade-chart.jsx` wraps `TradingViewAdvanced`. Toolbar functional.

### Phase 5 — Ticket (Ticket Agent)
- Order ticket wired to wallet + quote endpoint. Disabled states complete.

### Phase 6 — Tables & tabs
- Transactions table with flash animation. Holders. Top Traders. Tab switcher persists per token.

### Phase 7 — Insights row
- Sentiment / Signals / Outlook cards populate from `use-trade-insights`. Empty states degrade gracefully.

### Phase 8 — QA (QA Agent)
- Run §11 checklist. File defects. Re-run after fixes.

### Phase 9 — Ship
- `/review` → `/verify` → `/ship`. Follow the `prod` branch workflow in `apps/research/.claude/rules/git-workflow.md` (merge `origin/main` first, push `prod`, PR to `main`). **Do not auto-deploy.** Wait for Sunny's explicit "push" / "ship".

---

## 14. Anti-slop Guardrails (things to reject during review)

If any of these land in a PR, bounce it:

- Purple or blue-violet anywhere in the terminal chrome (accent gradient, active tab, sidebar active item, confidence bar).
- The string "AI" in a user-visible label.
- Emoji in the DOM.
- Gradient buttons (the Buy CTA is single-color `var(--bull)`, full stop).
- Spinner / "Loading..." text.
- Hardcoded mock data in a shipped component. `trade-constants.js` is for config, not fake trades.
- `import { X } from 'lucide-react'` inside `apps/research` (lucide is trading-app only).
- TypeScript syntax in a `.jsx` file.
- Raw `localStorage.getItem/setItem` — use the Zustand store.
- `formatPrice()` called directly — use `useCurrency()`.
- Hardcoded `/trade` path in a navigate call — use `getPathForPageId('trade')`.
- A new TradingView component forked from `TradingViewAdvanced.jsx`. Wrap, don't fork.
- A new "AI Insights" beta badge, brain icon, or sparkle.
- More than one primary CTA color on the page (the ticket CTA is the only saturated element).

---

## 15. Nice-to-haves (v1.5, track as TODO — do not ship in v1)

- Limit orders + DCA wiring.
- Auto-Buy tab (preset-based buy on new pair detection).
- Price alerts from the ticket ("Alert when MAGA > $0.05") → hands off to `/alerts`.
- Chart drawing-tool persistence keyed by token address.
- Pair selector in header (when a token has multiple pairs, let user switch).
- Compare mode (overlay a second token's price on the chart).
- Keyboard shortcuts: `B` = focus Buy amount, `S` = toggle to Sell, `1/2/3/4/5/6` = timeframe.
- PNL tracker: link positions from this ticket back into `/user-dashboard`.

---

## 16. Paste this into Claude Code

```
Read `/Users/sunny/Desktop/Spectre App Main/SPECTRE_TRADE_TERMINAL_BUILD.md` and execute it.
Start in plan mode. Confirm the agent swarm split in §12, then run Phases 1–8 in order
(with A/B/C/D/E in parallel inside the relevant phases). Do not push, deploy, or open a PR
until I say "ship". Smoke-test against MAGA on Solana:
Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump (networkId 1399811149).
```

---

**End of brief.** When in doubt: Bloomberg × Apple, warm-white on black, monospace numbers, no purple, no emoji, no "AI".
