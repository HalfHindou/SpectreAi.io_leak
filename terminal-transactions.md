# Agent — Terminal Transactions Table

## Mission
Live-updating virtualized transaction feed. This is the second heaviest component on the page after the chart. It must handle thousands of rows without dropping frames.

## Gate
Gate B. Prerequisites:
- `terminal-shell` complete
- `terminal-data-layer` complete (`useTransactions`, formatters)

## Files you own
```
src/features/trading-terminal/components/TransactionsTable.jsx
src/features/trading-terminal/components/TransactionsTable.module.css
src/features/trading-terminal/components/TokenHeaderCard.jsx
src/features/trading-terminal/components/TokenHeaderCard.module.css
```

**Note:** You also own `TokenHeaderCard` because it shares the same "card above chart" visual treatment and the same formatters. Build both.

## Files you MUST NOT touch
Any hook. Any other component.

## First step
```bash
ls src/features/trading-terminal/components/TransactionsTable.jsx 2>/dev/null
ls src/features/trading-terminal/components/TokenHeaderCard.jsx 2>/dev/null
npm list react-window
```

## Read before writing
1. `SPECTRE_TERMINAL_BUILD.md` §5.4 and §5.6
2. `SPECTRE_DESIGN_LAW.md`
3. The `useTransactions` and `useToken` signatures that data-layer exported (read `hooks/useTransactions.js` and `hooks/useToken.js` — do not modify them)

## Deliverable 1 — `TokenHeaderCard`

Top card in main column. One-row layout:

```
[logo 56px] [SYMBOL / QUOTE]  [$PRICE +CHANGE%]  [stat | stat | stat | stat | stat]
```

Where the 5 stats are: Market Cap / Liquidity / 24h Volume / Holders / FDV.

- Symbol: `var(--font-display)`, 32px, `letter-spacing: -0.04em`
- Price: `var(--font-mono)`, 40px, tabular-nums
- Price color: default `--text-primary`. Flash `--bull` tint for 300ms on price up-tick, `--bear` tint on down-tick. Use CSS custom property updated via ref.
- 24h change chip: pill with `rgba(16,185,129,0.08)` bg for positive, matching red for negative
- Stat labels uppercase `--text-tertiary` 11px, `letter-spacing: 0.16em`
- Stat values: `var(--font-mono)`, 18px
- Verified badge (top-right corner of card): small pill, `--bull` tint, shows only if `data.verified === true`
- On meme tokens without verified data (`verified === undefined`), show nothing — do not default to true or false

**Loading state:** skeleton shimmer bars for each slot. No spinner. Minimum shimmer display time 200ms to avoid flash.

**Error state:** single line `"Token data unavailable"` in `--text-muted`. Retry button underneath. Never show a stack trace.

## Deliverable 2 — `TransactionsTable`

Tabs header + virtualized table.

### Tab bar

```
Transactions | Holders (count) | Top Traders | Activity | Bubbles
```

- Active tab: `--accent` text color, no underline, weight 600
- Inactive tab: `--text-tertiary`
- Only the Transactions tab renders a table in this build. Other tabs render a centered `<EmptyState label="Coming soon" />` card.
- Tab headers on right side: `Filter` + `Columns` buttons (glass pill style)

### Table

Use `react-window`'s `FixedSizeList` for the tbody. Header is a regular HTML row outside the virtualization.

**Columns:**
| Time | Type | Price (SOL) | Amount (GMGN) | Total (SOL) | Maker | Tx |

Widths: `100px | 70px | 120px | 140px | 120px | 160px | 48px`. Remaining flex goes to Amount.

- Row height: 48px
- Font: `var(--font-mono)` for numeric columns, `var(--font-body)` for Type and Maker
- Type cell: `Buy` in `--bull`, `Sell` in `--bear`, weight 500
- Time cell: relative (`12s ago`) from `formatDuration`, updates once per second via a single interval at table level (not per row)
- Price / Amount / Total: `formatNumber` / `formatPrice` as appropriate
- Maker: truncated `7xKc...2f4e`, click-to-copy, tooltip on hover shows full address + wallet label if present
- Tx cell: arrow icon, opens explorer in new tab. Chain-aware URL:
  - sol → `https://solscan.io/tx/{tx}`
  - eth → `https://etherscan.io/tx/{tx}`
  - base → `https://basescan.org/tx/{tx}`
  - arb → `https://arbiscan.io/tx/{tx}`
  - bnb → `https://bscscan.com/tx/{tx}`

### New row flash animation

When a new transaction arrives via WebSocket (`useTransactions` prepends to its buffer), the row animates in with a brief tint:

```css
.row.flashBuy { animation: flashBuy 300ms ease-out; }
.row.flashSell { animation: flashSell 300ms ease-out; }

@keyframes flashBuy {
  0%   { background: rgba(16,185,129,0.14); }
  100% { background: transparent; }
}
@keyframes flashSell {
  0%   { background: rgba(239,68,68,0.14); }
  100% { background: transparent; }
}
```

Detect "new" by comparing `id` to a ref set of previously-seen ids. On the first render, don't flash anything.

### Reconnecting indicator

If `useTransactions().isConnected === false`, show a small badge in the tab bar: pulsing dot + `"Reconnecting…"` in `--text-tertiary`. No modal, no overlay, no error toast.

### Filter popover

Click `Filter` → glass popover anchored below. Contents:
- Buy / Sell / All segmented control
- Minimum total (number input, units = quote token)
- Maker contains (text input)
- Reset + Apply buttons

Filters are client-side over the current buffer. If a filter yields zero rows, show `<EmptyState label="No trades match filters" />`.

### Columns popover

Click `Columns` → glass popover with 7 checkboxes (one per column except Time which is locked). Selection persists in `localStorage` under `spectre:terminal:tx-columns:v1`.

## Performance

- `React.memo` the row component, compare on `id` only
- Time cell updates: one `setInterval` at the table level ticks a `now` value, passed via context. Individual rows read `now - row.t` with no state of their own.
- Flash classes: applied via direct DOM manipulation on insert, removed via `animationend`. Do not store flash state in React state.
- Buffer size capped at 100 rows (config `limit`). Overflow drops from the tail.
- `useDeferredValue` on the filter input if needed.

## Hard rules

- No Tailwind, no emojis, no Lucide.
- No spinner for reconnecting — pulsing dot only.
- Explorer links open with `target="_blank" rel="noopener noreferrer"`.
- Every number goes through a formatter. No ad-hoc `.toFixed()` in JSX.

## Stop condition

Stop when:
1. `TokenHeaderCard` renders MAGA with all 5 stats, verified badge (if API returns verified), and price flash on live updates
2. `TransactionsTable` virtualizes, flashes new rows, formats times correctly
3. Explorer links open the correct chain's explorer
4. Filter and Columns popovers work and persist
5. WebSocket disconnect shows the pulsing indicator
6. Performance: no dropped frames while inserting 10 rows/second (test with a mock burst)
7. Lint passes

Report: a screenshot of both components live with MAGA data, plus a 10-second screen recording of new trades flashing in.
