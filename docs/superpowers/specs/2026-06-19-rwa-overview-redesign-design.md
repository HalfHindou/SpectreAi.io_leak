# RWA Overview Tab — Cinematic Redesign

**Date:** 2026-06-19
**Owner:** Evgeniy
**Scope:** `/tokenized-assets` Overview tab, **desktop only**. Mobile render and the other 8 tabs are untouched.

## Goal

Reorganize and elevate the Overview landing into a premium, cinematic, well-paced
dashboard. **Keep every existing component and all functionality** — this is a
layout + visual-shell redesign, not a feature change.

## Problems with the current view

1. Row 1 crams 4 unlike widgets side-by-side (allocation donut, broken-looking
   global-hero chart, net-flows donut, Brain rail spanning 2 rows). No clear hero.
2. The big total value floats in black void with a spike chart behind it — reads
   as broken, not premium.
3. Bottom "intel" row is unbalanced: two short cards + an endless tweet feed →
   large dead black space on the left.
4. Flat cards, no depth, no spacing rhythm.

## New structure (6 sections, top→bottom narrative)

1. **Hero band** (full width) — Global hero: total value + stat ribbon (left) and
   the market area chart (right). One unified premium glass panel.
2. **Composition strip** (3 equal cards) — Asset Class Allocation · Net Flows (7D)
   · Chain Breakdown. Consistent donut/flow row.
3. **AI + Trend** (2 cols) — Spectre Brain rail · Active Mcap stacked chart.
4. **Leaders** (2 cols) — RWA Screener table (dominant) · Top Issuers.
5. **Thesis band** (full width) — editorial primer, calm wide reading band.
6. **Intel/social strip** (3 cols) — 7D Flow Board · RWA Pulse · RWA Voices
   (tweets), heights balanced via a capped + internally-scrolled feed.

## Visual language

- Unified glass shell for all cards: soft gradient glass, hairline border, layered
  shadow + inset highlight, 18–20px radius. Matches Spectre Apple-cinematic system.
- Hero: oversized total value with subtle glow, premium change badge, chart with a
  soft gradient fill that fills its area (kills the black void).
- Consistent section rhythm: uppercase eyebrow labels, generous gaps/padding,
  staggered fadeInUp entrance.
- Cap RWA Voices feed height + internal scroll so the bottom row stays balanced.

## Safety constraints

- Apply all styling under a **new wrapper scope class** (e.g. `.rwa-ov2`) instead of
  editing shared component internals. Components reused by mobile / other tabs
  (RwaClassAllocation, RwaActiveMcapChart, RwaThesis, RwaTweets, RwaChainDonut,
  RwaNetFlows, RwaGlobalHero, RwaTopIssuers, RwaBrainSidebar) keep their internals.
- JSX changes limited to the desktop `return` of `rwa-overview-tab.jsx` (row
  grouping/order). Mobile render in `tokenized-assets-page.jsx` untouched.
- Data/chart pipelines untouched (the hero spike is a known data issue, out of scope).
- Day-mode counterparts for every new surface.

## Files

- `apps/research/src/pages/tokenized-assets/components/rwa-overview-tab.jsx` — re-group rows.
- `apps/research/src/pages/tokenized-assets/components/overview.css` — new `.rwa-ov2` layout + shell.
- (Possibly) scoped tweaks for hero/donut shells via `.rwa-ov2 ...` selectors only.

## Verify

- Build clean (`npm run build:research`).
- Browser: all 6 sections render, all cards populated, screener filters work, drawer
  opens on row click, day-mode correct, no console errors, balanced bottom row.
