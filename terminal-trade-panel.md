# Agent — Terminal Trade Panel

## Mission
Right sidebar. Buy / Sell / DCA controls, amount inputs, quick-select pills, slippage + priority fee + routing details, and the primary CTA. This is where the user commits money — visual polish and signal clarity matter more than anywhere else.

## Gate
Gate B. Prerequisites:
- `terminal-shell` complete (right-panel slot ready)
- `terminal-data-layer` complete (`useToken`, `useWallet`)

## Files you own
```
src/features/trading-terminal/components/TradePanel.jsx
src/features/trading-terminal/components/TradePanel.module.css
src/features/trading-terminal/components/TradePanel/
  (if you want sub-components, place them here)
```

## Files you MUST NOT touch
Any hook. Any other component. Any wallet flow internals (re-use the existing modal).

## First step
```bash
ls src/features/trading-terminal/components/TradePanel.jsx 2>/dev/null
```

Also verify the existing wallet hook location and signature:
```bash
rg -l 'useWallet' src/ | head -20
```
Do not assume — read the actual hook before you import it.

## Read before writing
1. `SPECTRE_TERMINAL_BUILD.md` §5.7 (full)
2. `SPECTRE_DESIGN_LAW.md`
3. Existing `useWallet` hook (source)
4. Any existing trade/swap component in the repo — reuse patterns

## Deliverable

`<TradePanel chain={} address={} />`. Consumes `useToken(chain, address)` and `useWallet()`.

### Header

Small token preview card at top:
- Token logo 48px
- Symbol + `The friendly crocodile of Solana.` short description (comes from `data.name` / `data.description` if present, omit the second line if not)
- `Verified` pill top-right, `--bull` tint, only if `data.verified === true`

Below that, a 2x2 stat grid: Price USD / Price in base / 24H / Liquidity. Monospace values, `--text-tertiary` labels.

### Tab strip

`Trade | Auto Buy`. Trade active. Auto Buy disabled with `title="Coming in Phase 2"`.

### Buy/Sell toggle

Segmented control, 2 buttons. Active Buy: `--bull` at 0.14 bg, `--bull` text, weight 600. Active Sell: `--bear` at 0.14 bg. Non-active: `--text-tertiary` on `--bg-surface`.

### Order type

`Market | Limit | DCA`. Market default. Limit and DCA render but are disabled with `title="Coming in Phase 2"` tooltips. The form beneath only shows Market controls for this build.

### Pay With input

```
┌─────────────────────────────────────────┐
│ Pay With              Balance: 2.1349 SOL│
│                                          │
│  0.5                         [ SOL ▾ ]  │
│  ~$73.95                                │
└─────────────────────────────────────────┘
```

- Input: 28px font, `var(--font-mono)`, tabular-nums, right-aligned
- Token picker on right: opens a simple popover listing SOL / USDC / USDT (sol-side) or ETH / USDC / DAI (eth-side). Chain-aware. For now the chain determines the picker contents via a static map.
- USD estimate below: computed from `data.price` and the pay token's price. If pay-token price unknown, show `—` not `$0.00`.

### Quick amount pills

```
0.1 | 0.25 | 0.5 | 1 | 2
```

Segmented. Clicking sets the Pay input to that value. Active pill matches pill nav style elsewhere. Each pill also has a `title` showing its USD equivalent.

### Receive output

Same card pattern as Pay With, but read-only:
- Value: computed from pay amount / token price, minus slippage
- Token chip: target token (MAGA in the test case), with its logo
- USD estimate below

### Details block

Compact list, 4 rows, glass card:
- `Slippage Tolerance`: `0.5%` default. Click to open popover with 0.1 / 0.5 / 1 / 3 / custom. Warn in `--bear` if custom >5%.
- `Priority Fee`: `Auto (0.001 SOL)` default (SOL-chain). Click opens popover with Auto / Fast / Turbo tiers. Each shows estimated gas cost.
- `Routing`: `Best Route`, in `--accent` color. Click shows a tooltip: `"Routed via {DEX}"` once the route is resolved.
- `Network`: static `{Chain}` + icon. Not clickable.

### CTA

Full-width button, 56px tall, `--radius-lg` rounding, `--accent` solid. Label logic:

| Condition | Label | State |
|---|---|---|
| Wallet not connected | `Connect Wallet` | enabled, triggers `useWallet().connect()` |
| Wallet connected, input empty | `Enter an amount` | disabled |
| Input > balance | `Insufficient {PAY_TOKEN}` | disabled |
| Swap impact >5% | `Buy {SYMBOL} (High impact)` | enabled, button keeps `--accent` but adds `--bear` border |
| Ready | `Buy {SYMBOL}` | enabled |

Below CTA: estimate text `Est. 1 {SYMBOL} ≈ 0.000487 SOL` in `--text-tertiary`, 11px.

**On click of Buy:** for this build, open a confirmation sheet with the trade summary and a `Confirm in wallet` button. The actual on-chain execution is out of scope — stub with a `TODO: wire to swap executor` comment at the execution call site. Do not fake the transaction or show a fake success toast.

### Sell flow

Mirror of Buy, but:
- Pay With → uses the target token (user's balance of MAGA)
- Receive → uses a base token (SOL)
- CTA becomes `Sell {SYMBOL}`
- Segmented buttons switch sides on toggle

### States summary

| State | Visual |
|-------|--------|
| Loading | skeleton shimmer on the whole panel |
| Error | single glass card: `"Price unavailable"` in `--text-muted` + small retry link |
| No wallet | all inputs still interactive but CTA shows `Connect Wallet` |
| Insufficient balance | input gets `--bear` border, CTA disabled |

## Hard rules

- `--accent` solid is ONLY used on the final CTA button. Not anywhere else in this panel.
- No solid green buttons. Green is reserved for semantic state only (price up, Buy-active tint at 0.14 opacity).
- No emojis. Logos come from `data.logo` URL, fallback to a generated `linear-gradient` avatar.
- Every number is `var(--font-mono)`.
- Day mode: every surface re-themed via `.app.app-day-mode` rules.

## Validation

Use a small `useMemo` to compute derived values:
- `receiveAmount = payAmount * exchangeRate * (1 - slippage)`
- `swapImpact = <backend-provided or 0 for now>`
- `isValidAmount = payAmount > 0 && payAmount <= payBalance`

Never `eval`, never `parseFloat` without guarding NaN.

## Stop condition

Stop when:
1. Panel renders for MAGA with mock wallet balance
2. Buy/Sell toggle swaps input semantics
3. Quick-amount pills update the pay input
4. CTA label changes through all documented states
5. Connect Wallet triggers the existing modal
6. Day mode toggles correctly
7. Slippage popover works and warns above 5%
8. Lint passes

Report: screenshots of panel in 4 states (disconnected, connected + empty, connected + valid, connected + insufficient).
