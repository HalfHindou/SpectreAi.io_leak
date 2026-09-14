# Alerts 2.0 — Wave 4: Chart Lines + Long-press + Swipe Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert target lines on the token chart (both engines), long-press-to-create on the canvas engine, and swipe-left actions on Alerts-tab rows.

**Architecture:** `TradingChart.jsx` gains an `alertLines` prop (already-filtered `[{ id, price, direction }]`). Canvas engine draws them mirroring the in-file ATH/VWAP dashed-line pattern; TV Advanced mirrors the in-file "Spotted receipt" `createShape` lifecycle (`tvAdvChartRef` + `tvChartEpoch`). Long-press on the canvas price pane calls an optional `onAlertAtPrice(price)` prop; MobileTokenPage opens the alert sheet prefilled. Alerts-tab rows get swipe-left reveal, mirroring the existing mobile-home `mrow` swipe pattern.

**Tech Stack:** React 18, canvas 2D, TradingView charting_library shapes, touch events.

**Spec:** `docs/superpowers/specs/2026-07-24-alerts-v2-design.md` (section 4 "Алерт-линии"). Same branch, one PR.

## Global Constraints

- **Do NOT run `git commit` or `git push`** — NO-COMMITS mode; working tree only.
- No TypeScript. No emojis. Single dash in comments. Day mode `body.theme-light` for new CSS.
- `TradingChart.jsx` is ~5100 lines and fragile (chart-resize saga, dead LW tier): changes must be ADDITIVE and pattern-mirroring — no refactors, no touching the dead lightweight-charts tier, no changes to existing draw ordering beyond inserting the new block.
- Alert lines: dashed, subtle (`rgba(245,245,247,0.4)`-family, 1px, dash [4,3]); small right-edge label `ALERT` (10px). NOT the bull/bear colors (lines are targets, not P&L).
- pct rules never draw (no level). Only ACTIVE price rules for the CURRENT token.
- Long-press: 500ms hold, <10px movement, canvas engine only, fires only when the `onAlertAtPrice` prop exists (desktop doesn't pass it). Must NOT fire after a drag/scroll gesture.
- Swipe rows: reveal `Pause` + `Delete` behind swipe-left (~120px), snap open/closed, one row open at a time, tap elsewhere closes; the always-visible pause/delete buttons are REMOVED from active rows on touch reveal — but ONLY behind a `(pointer: coarse)` media check/class so desktop-width dev viewports keep the visible buttons.
- Verification: `npm run build:trading` green incl. check-critical-path per task.

## File Map

| File | Action | Task |
|---|---|---|
| `apps/trading/src/App.jsx` | Modify (compute + thread `alertLines`, `onAlertAtPrice` NOT here — mobile only) | 1 |
| `apps/trading/src/components/TradingChart.jsx` | Modify (canvas draw block + TVA shape effect + long-press) | 1, 2 |
| `apps/trading/src/components/mobile/MobileTokenPage.jsx` | Modify (onAlertAtPrice -> sheet prefill) | 2 |
| `apps/trading/src/components/mobile/MobileAlertSheet.jsx` | Modify (`initialPrice` prop) | 2 |
| `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` (+`.css`) | Modify (swipe reveal) | 3 |

---

### Task 1: `alertLines` prop — canvas + TVA rendering

**Files:**
- Modify: `apps/trading/src/App.jsx` — `const alertLines = useMemo(...)`: from `rules`, filter `type==='price' && status==='active' && token-match (address lowercase both sides + networkId)`, map to `{ id: r.id, price: r.condition?.targetPrice, direction: r.condition?.direction }`, drop rows without `price > 0`. Pass `alertLines={alertLines}` to EVERY `<TradingChart>` mount that renders the active token (desktop token view AND the mobile chart path — grep the mounts; MobileChartCard forwards props to TradingChart, verify and thread through it if needed).
- Modify: `apps/trading/src/components/TradingChart.jsx`:
  - Prop `alertLines = []`.
  - **Canvas branch:** in the main draw, right after the ATH/VWAP overlay block (dashed-line precedent at ~L2331-2354 — mirror its style exactly: `ctx.setLineDash([4,3])`, restore `[]` after), draw one horizontal line per alertLine whose price is inside the visible price range (use the same price->y transform the ATH line uses); right-edge label `ALERT` 10px, same font/measure pattern as the neighboring labels. Lines re-render for free with every draw pass — no new state.
  - **TVA branch:** mirror the Spotted-receipt lifecycle exactly (effect around L1348-1390 + ref capture at onChartReady ~L4845): a new `tvAlertShapesRef = useRef([])`; effect on `[alertLines, tvChartEpoch]`: remove all previous shape ids (try/catch each), then for each line `chart.createShape({ price: line.price }, { shape: 'horizontal_line', lock: true, disableSelection: true, disableSave: true, overrides: { linecolor: '#8a8a8f', linestyle: 2, linewidth: 1, showLabel: true, text: 'ALERT', textcolor: '#8a8a8f', horzLabelsAlign: 'right' } })` collecting ids. Cleanup on unmount + on epoch change. Every createShape/removeEntity in try/catch (widget may be mid-teardown — the Spotted code shows the pattern).

- [ ] **Step 1:** implement App.jsx memo + threading (verify the mobile path: App -> MobileTokenPage -> MobileChartCard -> TradingChart; add the passthrough props where missing).
- [ ] **Step 2:** canvas draw block.
- [ ] **Step 3:** TVA shape effect.
- [ ] **Step 4:** build green; report cites the mirrored patterns' line numbers.

### Task 2: Long-press to create (canvas engine, mobile only)

**Files:**
- Modify: `apps/trading/src/components/TradingChart.jsx` — optional prop `onAlertAtPrice`. In the CANVAS branch's existing touch handlers (find the touchstart/touchmove/touchend trio used for crosshair/pan): on touchstart arm a 500ms timer capturing the touch y; cancel on touchmove >10px, touchend, or gesture becoming a pan/pinch; on fire, convert y->price with the same transform the crosshair uses and call `onAlertAtPrice(price)`; also suppress the synthetic click that follows. No-op entirely when the prop is absent (desktop).
- Modify: `apps/trading/src/components/mobile/MobileTokenPage.jsx` — state `alertPrefillPrice`; pass `onAlertAtPrice={(p) => { setAlertPrefillPrice(p); setAlertOpen(true) }}` down the chart prop chain; pass `initialPrice={alertPrefillPrice}` to `<MobileAlertSheet>`; clear it on sheet close.
- Modify: `apps/trading/src/components/mobile/MobileAlertSheet.jsx` — prop `initialPrice`. When the sheet OPENS with `initialPrice > 0`: `alertType 'target'`, `mode 'price'`, `inputValue` = formatted price (>=1 toFixed(2) else toPrecision(4)), `direction` = above if initialPrice >= currentPrice else below. Must compose with the reset effect (apply AFTER the reset — e.g. in the open-reset effect itself when initialPrice present).

- [ ] **Step 1:** TradingChart long-press (report must name which existing touch handlers were extended and how pan/pinch conflicts are avoided).
- [ ] **Step 2:** MobileTokenPage + sheet prefill.
- [ ] **Step 3:** build green.

### Task 3: Swipe-left actions on Alerts-tab rows

**Files:**
- Modify: `apps/trading/src/components/mobile/home/MobileAlertsScreen.jsx` + `.css`

Mirror the existing mobile-home swipe row implementation (grep `apps/trading/src/components/mobile/home/` for the `mrow` swipe/touch pattern and reuse its approach — touchstart/move/end with translateX, threshold snap). Behavior:
- Active rules rows only (triggered rows keep the visible trash button).
- Swipe left reveals a 120px action tray: `Pause`/`Play` (per status) + `Delete` (red tint `--bear`).
- One open row at a time (module-scope or state of `openSwipeId`); tapping the row body or another row closes it.
- The always-visible pause/delete buttons on active rows are hidden when the device is touch-primary: wrap with a `matchMedia('(pointer: coarse)')` state; on fine pointers everything stays as today (dev-desktop and reviewers keep buttons).
- Day-mode counterparts for the tray.

- [ ] **Step 1:** implement.
- [ ] **Step 2:** build green; note which existing swipe pattern was mirrored (file:line).

---

## Self-review notes (plan time)

- Spec section 4 coverage: lines both engines (T1), long-press canvas-only with honest TVA exclusion (T2), swipes (T3). pct rules excluded from lines by the price>0 + type filter.
- Risk containment: all TradingChart edits mirror named in-file precedents (ATH dashed overlay, Spotted createShape lifecycle, existing touch trio); no refactors.
- Desktop unaffected: alertLines renders on desktop too (nice win, zero extra work); long-press + swipe are mobile-gated by prop absence / pointer:coarse.
