# Fund Account: Cards + Crypto

## Context
The Deposit button currently does two conflicting things simultaneously: opens Privy's MoonPay/Stripe modal AND shows the receive QR panel. The user wants a clean "Fund Account" flow with two distinct paths:
1. **Buy with Card** - fiat on-ramp via Privy (MoonPay/Stripe)
2. **Receive Crypto** - show wallet address + QR code

The current receive panel (QR + address) already works. The `fundWallet` call was just fixed (Privy v3 API signature). We need to split these into a proper chooser UX.

## Architecture

```
Deposit button click
  └─> activePanel = 'deposit'
      ├─ [Buy with Card] tile  ──> fundWallet({ address, options })  ──> Privy modal (MoonPay/Stripe)
      └─ [Receive Crypto] tile ──> activePanel = 'receive'  ──> QR + address (existing)
```

No new files needed. All changes are within existing files.

## Implementation

### 1. Add deposit chooser panel to `ud-wallets-section.jsx`

**File:** `apps/research/src/pages/user-dashboard/components/ud-wallets-section.jsx`

- Add new `activePanel` state value: `'deposit'` (alongside existing `'balances'`, `'receive'`, `'withdraw'`)
- Deposit button now toggles `activePanel` to `'deposit'` (instead of calling `onDeposit()` + setting `'receive'`)
- New deposit chooser panel renders when `activePanel === 'deposit'`:
  - Two glass tiles side by side:
    - **Buy with Card** - credit card icon, "Buy with Card" label, "Visa, Mastercard, Apple Pay" subtitle. onClick calls `onDeposit()` (triggers Privy fundWallet modal)
    - **Receive Crypto** - QR/download icon, "Receive Crypto" label, "Send from another wallet" subtitle. onClick sets `activePanel = 'receive'`
  - Back button / close at top to return to balances
- The existing receive panel (`activePanel === 'receive'`) stays as-is, but add a back arrow to return to `'deposit'` chooser

### 2. Update Deposit button behavior

**File:** `apps/research/src/pages/user-dashboard/components/ud-wallets-section.jsx`

Current (broken UX):
```js
onClick={() => {
  if (activePanel === 'receive') { setActivePanel('balances') }
  else { onDeposit(); setActivePanel('receive') }
}}
```

New:
```js
onClick={() => {
  setActivePanel(activePanel === 'deposit' || activePanel === 'receive' ? 'balances' : 'deposit')
}}
```

The Deposit button becomes a toggle for the deposit flow. Active state highlights when in `'deposit'` or `'receive'` panel.

### 3. Decouple `onDeposit` from the Deposit button

**File:** `apps/research/src/pages/user-dashboard/index.jsx`

- `handleDeposit` stays the same (calls `fundWallet`)
- It's now only triggered from the "Buy with Card" tile, not from the Deposit button directly

### 4. CSS for deposit chooser

**File:** `apps/research/src/pages/user-dashboard/user-dashboard.css`

Add styles for the deposit chooser panel:

```
.ud-w-deposit-chooser     - grid container, 2 columns, gap 12px
.ud-w-deposit-tile         - glass tile (card pattern), flex column, centered
.ud-w-deposit-tile:hover   - translateY(-2px), border brighten
.ud-w-deposit-tile-icon    - 40px circle, icon container
.ud-w-deposit-tile-label   - 0.875rem, weight 600, --text-primary
.ud-w-deposit-tile-desc    - 0.75rem, --text-tertiary
.ud-w-deposit-back         - ghost back button at top of receive panel
```

Day mode overrides for all new classes.

### 5. Receive panel back navigation

When in `'receive'` panel (QR + address), add a small back arrow button at the top that returns to `'deposit'` chooser, so the flow is:
```
balances -> deposit chooser -> receive (with back to chooser)
                            -> buy with card (Privy modal, stays on chooser)
```

## Files Modified
| File | Change |
|------|--------|
| `apps/research/src/pages/user-dashboard/components/ud-wallets-section.jsx` | Add deposit chooser panel, update button logic, add receive back nav |
| `apps/research/src/pages/user-dashboard/user-dashboard.css` | Deposit chooser tile styles + day mode |

## Verification
1. `npm run build:research` - clean build
2. Click Deposit button - shows chooser with two tiles (not Privy modal)
3. Click "Buy with Card" - opens Privy MoonPay/Stripe modal
4. Click "Receive Crypto" - shows QR + address panel with back button
5. Click back on receive panel - returns to chooser
6. Click Deposit button again while in chooser/receive - collapses to balances
7. Withdraw button still works independently
8. Day mode renders correctly
