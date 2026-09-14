# Mobile Markets drawer — reuse MobileScreener

**Date:** 2026-07-21
**App:** `apps/trading`
**Surface:** the Markets bottom sheet opened from the mobile left side-rail
(`MobileSideRail` → `MobileWatchlistDrawer`).

## Problem

`MobileWatchlistDrawer` mounts the **desktop** `LeftPanel` scoped to its
token-discovery section. On a phone that produces four stacked rows of chrome
before any token is visible (category tabs → chain chips → timeframe +
List/Heatmap → Filters/sort), plus desktop-sized cards that the drawer CSS then
fights with ~120 lines of `!important` overrides.

A purpose-built mobile board already exists — `mobile/home/MobileScreener.jsx`
(sticky category pills, `msc-strip` stat band, `MobileTokenRow` rows, floating
glass dock with timeframe · chain · sort). The drawer should use it.

## Design

### Structure

```
mwd-sheet (max-height 90vh, drag-to-dismiss — unchanged)
 ├ mwd-grabber-region        swipe-down to close (unchanged)
 ├ button.mwd-close          absolutely positioned top-right (replaces mwd-header)
 └ mwd-body                  the scroll container
    └ <MobileScreener />     sticky pills top, sticky dock bottom
```

The `Markets` title row and the stat tiles question are settled: **no title
row** — grabber + a small ✕ + the sticky pills. `MobileScreener`'s own
`msc-strip` (24H VOL / MOVERS hairline band) stays, since it is one thin line,
not a card row.

`.msc-tabs` and `.msc-dock` are `position: sticky`, so they anchor to
`.mwd-body` (the scroller) with no extra CSS.

### Props wired into MobileScreener

| Prop | Value in the drawer |
|---|---|
| `active` | `true` (the drawer unmounts when closed) |
| `selectToken` | wrapper: `selectToken(t)` then `onClose()` |
| `isInWatchlist` | derived from the `watchlist` array the drawer already receives |
| `addToWatchlist` / `removeFromWatchlist` | passed straight through |

`MobileWatchlistDrawer` currently receives `togglePinWatchlist` and
`reorderWatchlist` only for `LeftPanel`. After the swap they are unused — drop
them from the component signature and from the call site in `MobileTokenPage`
(or wherever it mounts) if nothing else needs them.

### Behavior

- **Tap a row** → open the token and close the drawer. One tap to the goal; the
  drawer is invoked from the token page, so the user is looking for what to view
  next. No peek layer on top of a sheet.
- **Long-press a row** → `MobileTokenPeek`. Already built into
  `MobileTokenRow`/`MobileScreener`; nothing to add.
- **Swipe right on a row** → toggle watchlist (existing `onSwipeRight`).
- **Swipe down on the grabber / tap backdrop / Esc** → close (unchanged).

### CSS cleanup

Delete from `MobileWatchlistDrawer.css` every rule that exists only to tame the
desktop panel: the `.mwd-body .screener-row-*` block, the main-feed
`height/max-height: none !important` overrides, `.mwd-header`, `.mwd-title`, and
the section-toggle leftovers. Add `.mwd-close` (floating icon button, ~32px,
glass, top-right, above the sticky pills).

## Non-goals

- Filter state is **not** persisted. The drawer returns `null` when closed, so
  `MobileScreener` remounts with defaults (Trending / 24h / All / Trend score)
  every open. Lifting that state to a parent is a later change if it annoys.
- `LeftPanel` itself is untouched — the desktop surface keeps its behavior.
- No new data hooks: `MobileScreener` uses the same `useTrendingTokens` /
  `useTopCoins` module-cached hooks the desktop table uses.

## Verification

1. `npm run build:trading` clean, `check-critical-path` OK.
2. On a mobile viewport: open the rail tab → sheet shows pills immediately, at
   least 4 token rows above the fold, dock pinned at the bottom of the sheet.
3. Tap a row → chart switches to that token and the sheet closes.
4. Long-press a row → peek opens over the sheet; close returns to the list.
5. Swipe a row right → watchlist star toggles.
6. Chain and Sort sheets open above the drawer and dismiss correctly.
7. Day mode (`body.theme-light`): pills, strip, rows and dock all readable.
