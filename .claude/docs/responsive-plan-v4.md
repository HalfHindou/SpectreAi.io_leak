# Spectre AI — Responsive Design Implementation Plan (v4 — Final)
## Claude Code Opus Master Prompt & Phased Execution Guide

---

## How to Use This Document

This document is a **complete implementation plan** designed to be fed to Claude Code Opus in phases. Each phase contains:
1. A **Claude Code prompt** you paste into the terminal
2. **Acceptance criteria** to verify before moving to the next phase

**One phase = one Claude Code session.** Phases are sized to avoid context exhaustion.

The plan follows a "design system first, Welcome page second, propagate everywhere third" strategy.

### Scope
- **Research app**: 37 lazy-loaded routes in App.jsx — primary target
- **Trading app**: 3 views (discover, token, dashboard) — needs separate mobile shell strategy
- **Developer Control app** (port 5182): standalone — out of scope for now

### Critical Architecture Facts
1. The Token Detail page on research is an **iframe embedding the trading app**. Mobile token detail requires coordinating BOTH apps.
2. The mobile shell (header, bottom nav, settings) is rendered **inline within app-shell.jsx** — NOT as separate standalone files in components/layouts/.
3. The app is transitioning from HTTP polling to **Binance WebSocket streaming** (useBinanceStream.js, binanceStreamService.js exist in both apps). Mobile optimization must account for both systems.
4. An **useInViewport** hook already exists (new) — Phase 5's IntersectionObserver work may be partially done.

---

## Architecture Overview

```
Phase 0A: File Audit         → Map all mobile files (components, hooks, CSS)
Phase 0B: CSS Token Audit    → Verify tokens + extend utilities
Phase 0C: Page Inventory     → Count and categorize all routes
Phase 0D: Mobile Shell Check → Verify shell in app-shell.jsx works correctly
Phase 1A: Welcome — Day Mode → Audit + fix day mode across 10 mobile components
Phase 1B: Welcome — PTR      → Create usePullToRefresh hook + wire into Welcome page
Phase 1C: Welcome — QA       → Hardcoded values, !important fixes, overflow, touch targets, no-regression
Phase 1D: Device Test         → Real device / simulator checkpoint
Phase 2:  Core Page 1        → Discover page mobile (prove data table pattern here)
Phase 3:  Core Page 2        → User Dashboard mobile (portfolio hero pattern)
Phase 4:  Extract & Share    → Extract MobileDataTable from Discover, extend CopyToast
Phase 5A: Token Detail Fdn   → Trading app foundation (useIsMobile, --m-* tokens, mobile CSS)
Phase 5B: Token Detail View  → Mobile token view component + research iframe integration
Phase 6:  Batch Rollout      → All remaining research pages in batches of 3-5
Phase 7:  Polish             → Micro-interactions, odometer, chart touch-scrub
Phase 8:  Performance        → Virtualization, viewport-aware updates, streaming optimization
Phase 9:  Trading App MVP    → Mobile token view in trading app (Option A)
```

---

## PHASE 0A — File Audit
**Goal**: Map every mobile-related file. This is READ ONLY — no changes.

```
TASK: Read and catalog all mobile-related files in the codebase. DO NOT modify anything.

Read these entry points:
- apps/research/src/components/layouts/app-shell.jsx (the ENTIRE file — mobile shell is rendered inline here, lines ~235-334)
- apps/research/src/styles/mobile-2026.css
- apps/research/src/hooks/useMediaQuery.js

Then scan and catalog:

1. MOBILE SHELL — examine app-shell.jsx and list:
   - Where mobile header is rendered (inline JSX, not a separate file)
   - Where mobile bottom nav is rendered
   - Where mobile settings panel is rendered
   - Where MobilePreviewContext / ?mobile=1 param is handled
   - Whether any mobile shell logic IS extracted to separate files or if it's all inline

2. SHARED MOBILE COMPONENTS — scan src/components/mobile/ and list ALL files:
   Expected to find (verify): digit-morph, skeleton-row, token-bottom-sheet,
   token-row-compact, token-row-full, token-row-minimal
   + any others

3. WELCOME PAGE COMPONENTS — scan pages/home/components/ and list ALL mobile-*.jsx files:
   Expected ~10 mobile-*.jsx files. For each note: file name, CSS prefix status, whether it imports any hooks

4. OTHER PAGE MOBILE COMPONENTS — scan ALL pages/*/components/ for mobile-*.jsx:
   Expected: research-zone/components/mobile-tab-bar.jsx, watchlists/components/mobile-bottom-sheet.jsx
   + any others

5. HOOKS — scan src/hooks/ for ALL mobile/responsive-related hooks:
   Expected: useMediaQuery.js (useIsMobile), useSwipeNavigation.js
   Check if these exist: usePullToRefresh.js, useAdaptivePolling.js, useBinanceStream.js, useInViewport.js
   For each: note if it exists, what it does, whether it's actively used or orphaned

6. CSS FILES — list ALL mobile-specific CSS:
   - styles/mobile-2026.css (global tokens)
   - pages/home/components/welcome-page.mobile.css
   - pages/home/components/mobile-home.css
   - Any other *.mobile.css or mobile-*.css files across all pages
   - Any .cinema-mode.css files (note these — affects mobile strategy)

7. TRADING APP — scan apps/trading/src/ briefly:
   - How many CSS files contain @media breakpoint rules?
   - What breakpoints are used? (likely 1400px, 1200px, etc.)
   - Does useBinanceStream.js or binanceStreamService.js exist?
   - Any mobile-specific files at all?

OUTPUT: Write a structured inventory as a comment in your response. Do not create files yet.
```

---

## PHASE 0B — CSS Token Audit & Utilities
**Goal**: Verify all mobile tokens are correct. Extend utilities only where gaps exist.

```
Read:
- .claude/rules/mobile-design-system.md
- apps/research/src/styles/mobile-2026.css
- The component inventory from Phase 0A (your previous output)

AUDIT mobile-2026.css:
1. Verify all tokens are inside @media (max-width: 768px)
2. Verify these ACTUAL token values (correct any that are wrong):
   - --m-bottom-nav-h: 76px
   - --m-content-pad: 8px
   - --m-xs: 4px (base spacing unit)
   - Font tokens use --m-text-* prefix (NOT --m-font-*)
3. Verify anti-wobble globals are present
4. List existing utility classes: .strip-scroll, .mobile-card, .mobile-skeleton, etc.
5. Check for any tokens that conflict with desktop design-system.md

EXTEND (only add what DOESN'T already exist):
- .m-stack: vertical flex stack with --m-* gap tokens (if no equivalent exists)
- .m-touch-target: min 44px height/width enforcer (if no equivalent exists)
- .m-sticky-bottom: fixed bottom positioning (if no equivalent exists)
- .m-safe-area: padding-bottom for env(safe-area-inset-bottom) (if no equivalent exists)

DO NOT add:
- .m-hide-desktop / .m-show-desktop — project uses JSX guards, NOT CSS display:none
- .m-scroll-x — if .strip-scroll already exists
- .m-glass-card — if .mobile-card already exists
- .m-skeleton — if .mobile-skeleton already exists

VERIFY: mobile-2026.css imports correctly in the app entry point and isn't nested inside another @media.

Report all findings and changes.
```

---

## PHASE 0C — Page Inventory
**Goal**: Count and categorize every route for the batch rollout plan.

```
Read:
- apps/research/src/App.jsx (all route definitions)
- Scan apps/research/src/pages/ directory listing

List ALL routes. For each note:
- Route path
- Page directory name
- Whether it renders inside AppShell or standalone
- Whether ANY mobile CSS or mobile components already exist for it
- Whether it has .cinema-mode.css files
- Complexity estimate (simple/medium/complex)

Categorize into these groups:

DATA PAGES: discover, watchlists, categories, heatmaps, bubbles, fear-greed, tokenized-assets
AI/CONTENT PAGES: intelligence, newsroom, news, ai-market-analysis, ai-charts, media-center
SOCIAL PAGES: social-zone, x-dash, x-bubbles, x-intel, x-intelligence, x-beta, lens, gm-dashboard
TOOL PAGES: roi-calculator, economic-calendar, search-engine, glossary, traders-corner
FULL-SCREEN PAGES: monarch-chat, world (3D globe), research-zone
STANDALONE PAGES: newsroom (standalone), website
USER PAGES: user-dashboard, you (profile)
OTHER: ventures, zigchain, + any pages not in these categories

Create: .claude/rules/responsive-rollout-plan.md with the full inventory.
Update: .claude/rules/mobile-design-system.md with an "## Implementation Status" section.
```

---

## PHASE 0D — Mobile Shell Verification
**Goal**: Confirm the mobile shell (header, bottom nav, settings) works correctly before touching pages.

```
Read:
- apps/research/src/components/layouts/app-shell.jsx (full file)
- .claude/rules/mobile-design-system.md

The mobile shell is rendered INLINE within app-shell.jsx. Verify:

1. MOBILE HEADER: renders at top, 52px height, hamburger left + logo center + tools right
2. BOTTOM NAV: renders at bottom, 76px total height (--m-bottom-nav-h)
   - 4+1 Robinhood layout: Home | Markets(dropdown 9 items) | Search(elevated center) | Social(dropdown 5 items) | Profile(dropdown 7 items)
   - Fixed position, never hides on scroll
3. SETTINGS PANEL: right-side drawer, accessible from header
4. Day mode: shell components have .app.app-day-mode counterpart styles
5. Safe area: bottom nav respects env(safe-area-inset-bottom)

EVALUATE: Should any shell logic be extracted to separate files for maintainability?
- If the inline shell code in app-shell.jsx is > 200 lines, consider extraction
- If extracting, put in components/layouts/ following existing conventions
- If NOT extracting, document why (e.g., tight coupling with app-shell state)

Report findings. Flag any shell issues that would block page work.

ALSO VERIFY ?mobile=1 PARAM:
All subsequent development relies on MobilePreviewContext for rapid iteration.
1. Load any page with ?mobile=1 appended to the URL
2. Verify it forces mobile layout even at desktop viewport widths
3. Verify it works with day mode toggle
4. If broken, fix it NOW — this is a critical dev tool for every future phase
```

---

## PHASE 1A — Welcome Page: Day Mode Fixes
**Goal**: Ensure every Welcome page mobile component works in day mode.

```
Context: Welcome page has 10 mobile-*.jsx component files in pages/home/components/.
Day mode requires every component to have .app.app-day-mode counterpart styles
(per design-system.md section H).

Read:
- .claude/rules/design-system.md (section H — day mode rules)
- apps/research/src/pages/home/components/ (ALL mobile-*.jsx AND their CSS files)

The 10 mobile components to audit:
- mobile-home-tab.jsx
- mobile-brief-card.jsx
- mobile-quick-stats.jsx
- mobile-watchlist-strip.jsx
- mobile-token-row.jsx
- mobile-token-list.jsx
- mobile-market-pulse.jsx
- mobile-content-tabs.jsx
- mobile-discovery-section.jsx
- mobile-highlights-tabs.jsx

For EACH component:
1. Check if it has .app.app-day-mode CSS rules
2. If missing: add day mode counterparts for backgrounds, text colors, borders, glassmorphism tints
3. If partial: complete the missing rules

Test approach: use ?mobile=1 URL param (verified in Phase 0D) + toggle day mode
to verify every component renders correctly in both modes.

NOTE ON RTL: The app has i18n with 8 locales. RTL layout support (if any locale is
Arabic/Hebrew) is OUT OF SCOPE for this responsive plan. Document this decision in the
rules file. If RTL is needed later, it's a separate initiative.

IMPORTANT — desktop no-regression check:
After adding day mode rules, verify desktop layout is unchanged. Mobile CSS must be
scoped inside @media (max-width: 768px) — if day mode rules are added outside the
media query by mistake, they'll break desktop.

Report: list each component and whether day mode was already complete, partially done, or missing.
```

---

## PHASE 1B — Welcome Page: Pull-to-Refresh
**Goal**: Create the pull-to-refresh hook (it doesn't exist yet) and wire it into the Welcome page.

```
Read:
- apps/research/src/hooks/ (scan for usePullToRefresh — it does NOT exist, must be created)
- apps/research/src/pages/home/ (Welcome page main component)
- apps/research/src/pages/home/components/welcome-page.mobile.css (may have PTR CSS ready)

1. CREATE usePullToRefresh hook:
   - Location: apps/research/src/hooks/usePullToRefresh.js
   - API: const { pullState, containerRef } = usePullToRefresh({ onRefresh: async () => {} })
   - Handles: touch start/move/end, threshold detection, loading state
   - Returns ref to attach to scrollable container
   - CSS class toggles for pull indicator animation
   - Check if welcome-page.mobile.css already has pull-to-refresh CSS — use it if so, create if not

2. WIRE pull-to-refresh into Welcome page:
   - Attach to main scrollable container
   - onRefresh should re-fetch the page's data
   - Test: pull down → loading indicator → data refreshes → indicator dismisses

Desktop no-regression check.
```

---

## PHASE 1C — Welcome Page: Cleanup & QA
**Goal**: Fix hardcoded values, resolve !important conflicts, and run full QA checks.

```
Read:
- apps/research/src/pages/home/ (all files)
- apps/research/src/pages/home/components/welcome-page.mobile.css
- apps/research/src/pages/home/components/mobile-home.css
- apps/research/src/styles/mobile-2026.css
- .claude/rules/mobile-design-system.md

## HARDCODED VALUE CLEANUP:
- Search Welcome page mobile CSS for hardcoded pixel values
- Replace with --m-* tokens where appropriate
- Common offenders: font-size, padding, margin, gap, border-radius
- Leave values that are genuinely one-off (e.g., specific icon sizes)

## !IMPORTANT CONFLICT RESOLUTION:
- Audit for !important in Welcome page mobile CSS files
- Resolve specificity wars between mobile-2026.css, welcome-page.mobile.css, mobile-home.css
- Prefer more specific selectors over !important
- Document any !important that MUST remain (e.g., overriding third-party library)

## QA CHECKS:

1. HORIZONTAL OVERFLOW:
   - At 375px width: no horizontal scrollbar on page body
   - Only .strip-scroll containers should scroll horizontally
   - Common causes: tables, images without max-width, flex items without min-width:0

2. TOUCH TARGETS:
   - Every interactive element >= 44px tap target
   - Bottom nav items, tab buttons, card tap zones, links

3. BOTTOM NAV CLEARANCE:
   - No content hidden behind the 76px bottom nav zone

4. GLASSMORPHISM:
   - No blur > 8px on any mobile element

5. TOKEN USAGE:
   - No hardcoded mobile values that should be --m-* tokens
   - Font sizes use --m-text-* prefix

6. DAY MODE:
   - Toggle day mode: verify every component (from Phase 1A)

7. DESKTOP NO-REGRESSION:
   - View at 1024px+: desktop layout must be unchanged
   - Check for any mobile CSS that leaked outside @media (max-width: 768px)

After passing all checks:
Update .claude/rules/mobile-design-system.md: Welcome page → COMPLETE
```

---

## PHASE 1D — Real Device Testing Checkpoint
**Goal**: Verify on actual mobile hardware before proceeding to new pages.

```
This is a MANUAL checkpoint — not a Claude Code session.

Test the Welcome page on at least one real device or simulator:
- iPhone (Safari): test safe area insets, touch events, virtual keyboard, rubber-band scroll
- Android (Chrome): test touch targets, pull-to-refresh feel, day mode

What to verify that desktop Chrome DevTools can't catch:
1. Touch events feel responsive (no 300ms tap delay)
2. Safe area padding renders correctly on notched devices
3. Pull-to-refresh doesn't conflict with browser's native pull-to-refresh
4. Bottom nav doesn't overlap browser chrome
5. Scroll performance is smooth (no jank from backdrop-filter)
6. ?mobile=1 param works on actual devices for testing other pages

Document any issues found. Fix before proceeding to Phase 2.
```

### Welcome Page Acceptance Criteria
- [ ] Renders correctly at 375px, 390px, 414px
- [ ] No horizontal scrollbar on page body
- [ ] Pull-to-refresh works end-to-end
- [ ] Day mode works on every mobile component (10 files)
- [ ] No !important conflicts
- [ ] No hardcoded values (all --m-* tokens)
- [ ] Glassmorphism ≤8px blur
- [ ] Touch targets ≥44px
- [ ] Bottom nav 76px zone clear
- [ ] Desktop layout unchanged (no-regression)
- [ ] Tested on real device or simulator (Phase 1D checkpoint)

---

## PHASE 2 — Discover Page Mobile (Prove Data Table Pattern)
**Goal**: Build mobile Discover page FIRST, then extract the data table in Phase 4. Don't build a generic component before knowing what real pages need.

```
Context: The Discover page (/discover) is the primary token discovery experience.
It's data-heavy and the best place to prove the mobile data table pattern.

Read:
- .claude/rules/mobile-design-system.md
- apps/research/src/pages/discover/ (ALL files — understand desktop implementation)
- apps/research/src/components/mobile/ (existing shared components: digit-morph,
  skeleton-row, token-bottom-sheet, token-row-compact, token-row-full, token-row-minimal)
- apps/research/src/hooks/useMediaQuery.js (useIsMobile)

## IMPORTANT: Check existing shared mobile components first!
src/components/mobile/ already has 6 components:
- digit-morph — may be useful for price display
- skeleton-row — loading state
- token-bottom-sheet — may overlap with watchlists' bottom sheet
- token-row-compact, token-row-full, token-row-minimal — token display variants

USE these existing components where they fit. Don't rebuild what's there.

## Discover Page Mobile Layout:

1. Shell provides MobileHeader + MobileBottomNav (via app-shell.jsx)
2. Filter/sort controls:
   - On desktop: likely dropdowns/selectors
   - On mobile: horizontal scroll pills for quick filters, bottom sheet for advanced filters
   - Use existing token-bottom-sheet if it fits, or page-specific bottom sheet
3. Token list:
   - Build the data table pattern INLINE in this page first (don't abstract yet)
   - Sticky first column: # + Token (logo + name + ticker)
   - Scroll columns: Price, 24h%, 7d%, MCap, Volume
   - Use .strip-scroll for horizontal scroll
   - 48px row height, proper touch targets
   - Use existing skeleton-row for loading state
   - Use existing token-row-compact/full/minimal if they match the need
   - Right-edge gradient fade to indicate more columns
   - Green/red + ▲▼ for % changes
   - Row tap → navigate to token page
4. Category tabs if the page has them

## Key Rules:
- useIsMobile() for JSX guards (NOT CSS display:none)
- Create pages/discover/components/discover.mobile.css
- --m-* tokens only, support day mode
- CSS prefix: dsc- (or similar short prefix)
- Wire usePullToRefresh (created in Phase 1B)

## Cinema mode: if Discover has .cinema-mode.css, note how it interacts with mobile.
On mobile, cinema mode should probably be disabled or show a simplified view.

Desktop no-regression check.
Update .claude/rules/mobile-design-system.md: Discover → COMPLETE
```

---

## PHASE 3 — User Dashboard Mobile
**Goal**: Build the portfolio overview — the user's personal financial snapshot.

```
Context: User Dashboard (/user-dashboard) is the portfolio page. Uses the Robinhood
pattern of portfolio value as the hero element.

Read:
- .claude/rules/mobile-design-system.md
- apps/research/src/pages/user-dashboard/ (all files)
- apps/research/src/components/mobile/ (existing shared components)
- apps/research/src/hooks/useMediaQuery.js

## User Dashboard Mobile Layout:

1. Shell provides MobileHeader + MobileBottomNav
2. Portfolio value hero:
   - Large number (use digit-morph from components/mobile/ if it fits)
   - 24h P&L with green/red + ▲▼
   - Subtle color wash: green tint if up, red tint if down
3. Portfolio chart — full-width, time range tabs
4. Holdings list:
   - Use token-row-compact/full from components/mobile/ if they fit
   - Or card-based layout: each card shows token, amount, value, P&L
5. Recent activity — compact transaction list
6. Quick actions — horizontal scroll pills: Add Funds, Trade, Alerts, Settings

## Key Rules:
- useIsMobile() for JSX guards
- Create pages/user-dashboard/components/user-dashboard.mobile.css
- --m-* tokens, day mode support
- Wire usePullToRefresh
- Prefix: udb- (or similar)
- Check for cinema mode CSS interactions

Desktop no-regression check.
Update .claude/rules/mobile-design-system.md: User Dashboard → COMPLETE
```

---

## PHASE 4 — Extract Shared Components
**Goal**: NOW extract the data table pattern (proven on Discover) and extend the toast system. Only abstract what's been proven on real pages.

```
Context: Discover page and User Dashboard are done. The data table pattern has been
proven on a real page. Now extract it for reuse.

Read:
- apps/research/src/pages/discover/ (the proven data table implementation)
- apps/research/src/components/mobile/ (existing 6 shared components)
- apps/research/src/contexts/ (find CopyToastContext)

## 1. Extract MobileDataTable

Take the data table pattern built inline in the Discover page and extract to a shared component:
- Location: apps/research/src/components/mobile/mobile-data-table.jsx
- Extract the JSX, CSS, and logic that handles:
  - Sticky first column
  - Horizontal scroll with .strip-scroll
  - Skeleton loading (using existing skeleton-row)
  - Right-edge gradient fade
  - Row tap handler
  - 48px row height
- Props: columns, data, stickyColumns (default: 1), onRowClick, loading
- CSS prefix: mdt-
- Must support day mode
- Refactor Discover page to USE the extracted component (verify it still looks identical)

## 2. Extend CopyToastContext (NOT a new MobileSnackbar)

The project already has CopyToastContext for copy-to-clipboard toasts.
DO NOT create a parallel toast system. Instead, extend the existing one:

- KEEP the name CopyToastContext (renaming breaks every import — not worth it)
- Optionally export an alias: export const useToast = useCopyToast
- Add: configurable message (not just "Copied!")
- Add: optional action button (label + callback) for undo functionality
- Add: configurable duration (default 4000ms)
- Add: swipe-to-dismiss on mobile
- Add: positioning above 76px bottom nav zone on mobile
- Keep 100% backward compatibility — existing useCopyToast() calls must work unchanged

## 3. Evaluate component promotions:
- mobile-bottom-sheet.jsx (in watchlists/) — was it also useful for Discover filters?
  If yes → copy to components/mobile/ for sharing
  If no → leave in watchlists/
- mobile-tab-bar.jsx (in research-zone/components/) — same evaluation

After extraction:
- Verify Discover page renders identically using the extracted MobileDataTable
- Verify existing copy toast still works after CopyToastContext extension
- Update .claude/rules/mobile-design-system.md with new component APIs
```

---

## PHASE 5A — Token Detail: Trading App Foundation
**Goal**: Give the trading app the minimum mobile infrastructure needed for a mobile token view.

```
Context: Token Detail (/token/:id) on research is an IFRAME embedding the trading app.
The trading app has 900+ CSS breakpoint rules (mostly 1400px/1200px, not 768px),
no useIsMobile(), no --m-* tokens, no mobile shell.

Read:
- apps/trading/src/ (scan structure, component count, CSS breakpoint usage)
- apps/research/src/styles/mobile-2026.css (to copy --m-* token definitions)
- .claude/rules/mobile-design-system.md

## Recommended: Option A — Trading App Builds Own Mobile Token View

Why Option A over Option C (iframe adapter):
- Option C (postMessage + dual CSS) creates compounding tech debt
- Option A gives the trading app independent mobile capability
- Token view is the ONLY trading app view that matters for research app embedding
- Can be an MVP: just the mobile token view, not a full trading app mobile shell

## This session — foundation only:

1. Add useIsMobile hook to the trading app
   - Simpler than research app's — just a matchMedia check for 768px
   - Location: apps/trading/src/hooks/useIsMobile.js (or equivalent)

2. Add mobile CSS token file to trading app
   - Copy --m-* token definitions from research app's mobile-2026.css
   - Location: apps/trading/src/styles/mobile-tokens.css (or similar)
   - Scope inside @media (max-width: 768px)
   - Include: --m-content-pad, --m-bottom-nav-h, --m-xs, --m-text-*, etc.

3. Create a mobile CSS file for the token view
   - Location: apps/trading/src/components/token/token-view.mobile.css (or appropriate path)
   - Import the token definitions
   - Stub out the basic structure (will be filled in Phase 5B)

4. Verify the trading app builds and runs without breaking existing desktop functionality

DO NOT build the actual mobile token view layout yet — that's Phase 5B.
Create: .claude/rules/token-detail-mobile-strategy.md documenting Option A decision.
```

---

## PHASE 5B — Token Detail: Mobile Token View + Iframe Integration
**Goal**: Build the mobile token view in the trading app and connect it through the research iframe.

```
Read:
- apps/trading/src/ (token view component — find the main one)
- apps/trading/src/hooks/useIsMobile.js (created in 5A)
- apps/trading/src/styles/mobile-tokens.css (created in 5A)
- apps/research/src/pages/token/ (the iframe wrapper)
- .claude/rules/token-detail-mobile-strategy.md

## In the TRADING APP — build mobile token view:

Using useIsMobile(), add conditional mobile rendering in the token view:

Layout (single column):
1. Token header: name + logo (no back button — research shell provides navigation)
2. Price hero: large price + 24h% with ▲▼
3. Stats pills: horizontal scroll (MCap, Vol, Supply, Holders)
4. Chart: full-width, time range tabs, 240px height
5. Tab content: Overview | Analysis | Markets | News

Rules:
- No bottom nav in trading app — research shell provides that
- No mobile header in trading app — research shell provides that
- --m-* tokens for all mobile values
- Day mode support (.app.app-day-mode counterparts)
- Hide desktop chrome (sidebar panels, top bar) when isMobile

## In the RESEARCH APP — iframe integration:

1. Detect isMobile in the token page iframe wrapper
2. Pass isMobile to trading app via URL param (?mobile=1)
3. Adjust iframe sizing for mobile (full width, no sidebar chrome)
4. Ensure research app's bottom nav and header remain visible around the iframe

Desktop no-regression for BOTH apps.
Update .claude/rules/mobile-design-system.md: Token Detail → COMPLETE
```

---

## PHASE 6 — Batch Rollout
**Goal**: Apply mobile to all remaining research app pages.

### 6A. Claude Code Prompt — Finalize Batch Plan

```
Read:
- .claude/rules/responsive-rollout-plan.md (from Phase 0C)
- .claude/rules/mobile-design-system.md
- apps/research/src/components/mobile/ (all shared components including new MobileDataTable)

Review the page inventory from Phase 0C. Remove pages already done:
- Welcome (Phase 1)
- Discover (Phase 2)
- User Dashboard (Phase 3)
- Token Detail (Phase 5)

Group remaining pages into batches of 3-5 similar pages.
Order by template similarity and user traffic priority.
Budget 10-12 batches total (pages vary wildly in complexity).

INCLUDE these pages the earlier plan missed:
- traders-corner
- tokenized-assets
- ventures
- zigchain
- + any others found in Phase 0C

## CSS PREFIX REGISTRY
Establish a convention upfront — first letters of page name. Create a registry table
in responsive-rollout-plan.md so all prefixes are documented in one place:

| Page | Prefix | Example |
|------|--------|---------|
| economic-calendar | ec- | .ec-header |
| fear-greed | fgr- | .fgr-gauge |
| watchlists | wl- | .wl-card |
| social-zone | sz- | .sz-feed |
| ... | ... | ... |

Fill in ALL pages. This prevents prefix collisions and makes grep-ability consistent.

## COMPLEX PAGES — flag for dedicated sessions:

These pages need special handling and should NOT be batched with simpler pages:

1. **monarch-chat** (AI chat) — COMPLEX
   - Full-screen chat has unique mobile patterns: keyboard pushing content up,
     input pinned to bottom, message bubbles, auto-scroll to latest message
   - This is NOT a standard single-column conversion
   - Give it its own batch (session)

2. **research-zone** (Remotion video rendering) — COMPLEX
   - Remotion is extremely heavy on mobile GPU/memory
   - Strategy: disable Remotion rendering on mobile, show static preview/thumbnail instead
   - Document this decision

3. **world** (Three.js/R3F 3D globe) — COMPLEX
   - Three.js 3D rendering has severe GPU/memory constraints on mobile
   - Strategy: replace with a static map fallback or simplified 2D view on mobile
   - Document this decision

4. **liquidation-heatmap** — COMPLEX
   - Canvas/SVG visualization needs to be resized AND simplified for mobile
   - Not just CSS responsive — the visualization logic itself needs mobile adaptation

5. **heatmaps / bubbles** — MEDIUM-COMPLEX
   - Similar canvas/SVG visualization concerns

## CINEMA MODE STRATEGY — decide for each page:
- Pages with .cinema-mode.css: on mobile, disable cinema mode entirely
  (cinema mode is a desktop fullscreen experience, not meaningful on mobile)
- Document per page

Update .claude/rules/responsive-rollout-plan.md with final batch plan.
```

### 6B. Per-Batch Prompt Template

```
Context: Implementing mobile for batch [N]: [page names]. These are [template type] pages.

Read:
- .claude/rules/mobile-design-system.md
- .claude/rules/responsive-rollout-plan.md (check prefix registry for this batch's pages)
- [Specific page files for this batch]

For EACH page:

1. Read desktop implementation completely
2. Check src/components/mobile/ for reusable components (MobileDataTable, token rows, etc.)
3. Use useIsMobile() for JSX guards — NOT CSS display:none
4. Single-column layout on mobile
5. Shell provides MobileHeader + MobileBottomNav via app-shell.jsx
6. Create page-specific mobile CSS: pages/{name}/components/{name}.mobile.css
7. --m-* tokens only
8. Day mode: .app.app-day-mode counterparts for all new mobile styles
9. CSS prefix: use the prefix from the registry table (responsive-rollout-plan.md)
10. Wire usePullToRefresh where page has refreshable data
11. All touch targets >= 44px
12. No horizontal overflow

ANTI-PATTERN CHECKS (every page):
- No blur > 8px
- No hover-only interactions
- No hardcoded pixel values
- No position:fixed overlapping 76px bottom nav
- No CSS display:none for mobile toggling
- No font-size below --m-text-* minimum
- Every new style has day mode counterpart

SPECIAL HANDLING:
- Full-screen pages (monarch-chat, world, research-zone):
  May need to hide bottom nav and use full viewport.
  Check if app-shell has a full-screen mode flag.
- Standalone pages (outside AppShell):
  Need own minimal mobile layout — no shell components available.
- Pages with .cinema-mode.css: disable cinema mode on mobile.
- Canvas/SVG visualization pages: simplify the visualization, don't just CSS-shrink it.

DESKTOP NO-REGRESSION: verify at 1024px+ after changes.

Update .claude/rules/mobile-design-system.md status table.
```

### 6C. Post-Batch-Rollout Device Checkpoint

```
After completing all batches, repeat the Phase 1D real device testing:
- Test 3-5 representative pages on a real device / simulator
- Priority: one data page, one complex page, one social page, one tool page
- Verify touch, scroll, safe areas, keyboard behavior
- Document issues and fix before proceeding to Phase 7
```

---

## PHASE 7 — Polish: Micro-interactions
**Goal**: Add premium interactions that differentiate Spectre AI.

```
Read:
- .claude/rules/mobile-design-system.md
- apps/research/src/components/mobile/digit-morph (already exists — evaluate)

## 1. Price Odometer (EVALUATE digit-morph first)
- src/components/mobile/digit-morph already exists
- Read it. Does it do odometer-style number rolling?
  If yes: ensure it's used on price displays across mobile pages
  If partial: enhance with color flash (green/red) on change
  If no: build odometer behavior into it or create a wrapper
- Respect prefers-reduced-motion

## 2. Chart Touch-Scrub with Haptic Feedback
- Location: trading app (token chart is in trading app, not research)
- The chart uses TradingView lightweight-charts library
- Touch crosshair/scrub is a LIBRARY FEATURE — configure it, don't build from scratch:
  - Check lightweight-charts docs for crosshair config + subscribeCrosshairMove
  - Enable touch crosshair mode in the chart options
  - Add navigator.vibrate(10) callback in subscribeCrosshairMove handler
- The trading app chart currently uses a 1400px breakpoint — align with 768px for mobile

## 3. Card Interactions (ENHANCE existing)
- Cards already have :active { scale(0.92) }
- Add: expand animation from origin point
- Evaluate useSwipeNavigation: currently only for tab swiping
  Can it be extended for card swipe actions? (swipe right = watchlist add)
  If extending is clean, do it. If it complicates the hook, create a separate useSwipeAction.

## 4. Snackbar Integration
- Use the extended CopyToastContext (from Phase 4) for:
  - Watchlist add/remove with undo action
  - Trade confirmation feedback
  - Any action that needs brief confirmation

## 5. Navigation Transitions
- Subtle fade between route changes
- Tab content cross-fades (check if MobileContentTabs already does this)

## Rules:
- All animations < 300ms (page transitions: 200ms)
- CSS transforms/opacity only
- will-change only when imminent, remove after
- prefers-reduced-motion respected
- Day mode compatible
```

---

## PHASE 8 — Performance Optimization
**Goal**: Make mobile fast on real devices.

```
Read:
- .claude/rules/mobile-design-system.md
- apps/research/src/hooks/ (check for useAdaptivePolling, useBinanceStream, useInViewport)
- apps/trading/src/ (check for binanceStreamService.js, useBinanceStream.js)

## 1. Check New Hooks First
BEFORE building anything, check what already exists:
- useInViewport — may already do IntersectionObserver viewport tracking
- useAdaptivePolling — may already handle mobile polling optimization
- useBinanceStream / binanceStreamService — WebSocket streaming may already be in progress

For each: read the code, understand what it does, note if it's used or orphaned.

## 2. Virtualized Lists (genuinely needed)
- ⚠️ DEPENDENCY APPROVAL NEEDED: neither react-window nor @tanstack/virtual is currently installed
- Before implementing, evaluate:
  - react-window: ~6KB gzipped, minimal API, widely used
  - @tanstack/virtual: ~10KB gzipped, more features, framework-agnostic
  - Document bundle size impact and get approval before installing
- Priority: token lists on Discover, watchlists, search results
- Integrate with MobileDataTable component
- Measure: scroll at 60fps with 1000+ items

## 3. Viewport-Aware Updates
- If useInViewport exists and works: wire it into price-updating components
- If not: implement IntersectionObserver wrapper
- Only re-render prices for tokens currently in viewport
- Particularly important for long virtualized lists

## 4. Data Streaming Optimization
- If useBinanceStream is active: ensure mobile throttling (batch updates, ~1s intervals)
- If still on polling (useAdaptivePolling): reduce frequency on mobile
- Background tab: reduce/pause updates (Page Visibility API — may already be implemented)

## 5. Bundle Check
- Vite already has manual chunks — verify they're working
- Verify all 37 routes are genuinely lazy loaded
- Check chart library is dynamically imported

## 6. CSS Performance
- Audit backdrop-filter usage on mobile (GPU-intensive)
- Check for expensive CSS selectors in mobile files

## 7. Core Web Vitals
- LCP: < 2.5s on 4G
- CLS: < 0.1 (explicit dimensions on images/dynamic containers)
- FID: < 100ms

Report: performance baseline with before/after metrics.
```

---

## PHASE 9 — Trading App Mobile (Full Strategy)
**Goal**: Extend Phase 5's MVP token view to cover all trading app views if needed.

```
This phase is OPTIONAL and depends on product roadmap. Evaluate after Phase 8.

If standalone trading app mobile access is needed:
1. Trading app gets full mobile shell (header, bottom nav adapted for trading context)
2. All 3 views (discover, token, dashboard) get mobile layouts
3. Shared --m-* token system imported from research app or duplicated

If only iframe embedding matters:
- Phase 5 MVP is sufficient
- Focus on polish and performance instead

Write recommendation and save to .claude/rules/trading-app-mobile-strategy.md
```

---

## Design System Rules Quick Reference (FINAL — CORRECTED)

```
╔═══════════════════════════════════════════════════════════╗
║  SPECTRE AI MOBILE DESIGN RULES — FINAL CHEAT SHEET      ║
╠═══════════════════════════════════════════════════════════╣
║  Breakpoint:     768px (THE one breakpoint)               ║
║  Small mobile:   380px (iPhone SE only)                   ║
║  Token prefix:   --m-*                                    ║
║  Max blur:       8px (never 20px)                         ║
║  Touch target:   44px minimum, 48px preferred             ║
║  Bottom nav:     76px total (--m-bottom-nav-h)            ║
║  Row height:     48px for lists                           ║
║  Padding:        8px horizontal (--m-content-pad)         ║
║  Chart height:   240px on mobile                          ║
║  Animation:      <300ms, transforms/opacity only          ║
║  Data:           HTTP polling + Binance streaming (both)  ║
║  Day mode:       REQUIRED — always .app.app-day-mode      ║
║  Spacing base:   4px (--m-xs)                             ║
║  Font tokens:    --m-text-* (NOT --m-font-*)              ║
║  Icons:          Icon + label always (not icon-only)       ║
║  Color coding:   Green/red + ▲▼ arrows (a11y)            ║
║  Mobile toggle:  JSX guards only (NOT CSS display:none)   ║
║  File type:      .jsx only (NO .tsx in app code)          ║
║  No barrel files (no index.js exports)                    ║
║  CSS files:      Per-page: {page}.mobile.css              ║
║  Nav tabs:       Home|Markets|Search|Social|Profile       ║
║  Bottom nav:     4+1 Robinhood layout with dropdowns      ║
║  Shell:          Inline in app-shell.jsx (not separate)   ║
║  Components:     Page-specific stay in pages/{name}/      ║
║  Shared:         Only if used by 2+ pages → components/   ║
║  Existing shared: 6 in components/mobile/ (digit-morph,   ║
║    skeleton-row, token-bottom-sheet, token-row-*)         ║
║  Cinema mode:    Disable or simplify on mobile            ║
║  No-regression:  Verify desktop after every phase         ║
║  RTL:            OUT OF SCOPE (deferred, separate init.)  ║
║  CSS prefixes:   Registry table in rollout-plan.md        ║
║  Heavy pages:    Remotion/Three.js → static fallback      ║
╚═══════════════════════════════════════════════════════════╝
```

---

## Execution Checklist (FINAL)

| Phase | Description | Status |
|-------|-------------|--------|
| 0A | File audit (read only) | ☐ |
| 0B | CSS token audit + extend utilities | ☐ |
| 0C | Page inventory + categorization | ☐ |
| 0D | Mobile shell + ?mobile=1 verification | ☐ |
| 1A | Welcome — day mode fixes (10 components) | ☐ |
| 1B | Welcome — create + wire pull-to-refresh | ☐ |
| 1C | Welcome — hardcoded values, !important, QA | ☐ |
| 1D | Real device testing checkpoint | ☐ |
| 2 | Discover page mobile (prove data table pattern) | ☐ |
| 3 | User Dashboard mobile (portfolio hero pattern) | ☐ |
| 4 | Extract MobileDataTable + extend CopyToastContext | ☐ |
| 5A | Token Detail — trading app foundation | ☐ |
| 5B | Token Detail — mobile view + iframe integration | ☐ |
| 6A | Batch rollout plan + prefix registry | ☐ |
| 6B×N | Execute batches (est. 10-12 batches) | ☐ |
| 6C | Post-rollout device testing checkpoint | ☐ |
| 7 | Micro-interactions polish | ☐ |
| 8 | Performance (virtualization, viewport, streaming) | ☐ |
| ~~PWA~~ | ~~Already done~~ | ✅ |
| 9 | Trading app mobile (optional, roadmap-dependent) | ☐ |

**Optional / Deprioritized:**
| Task | Description | Status |
|------|-------------|--------|
| CSS prefix migration | Rename mobile-brief- → mbc-, mobile-quick-stat- → mqs- | DEFERRED |

---

## Tips for Working with Claude Code Opus

1. **Start every session** with: "Read .claude/rules/mobile-design-system.md" — single source of truth.

2. **One phase per session.** Phases are sized to stay within context limits.

3. **After each phase**, have Claude Code update the Implementation Status section.

4. **If Claude Code drifts**: paste the cheat sheet and say "Check your work against these rules."

5. **Test at three widths**: 375px (iPhone SE), 390px (iPhone 15), 414px (iPhone Plus).

6. **Day mode is mandatory**: never skip .app.app-day-mode counterparts.

7. **Desktop no-regression**: verify at 1024px+ after EVERY phase.

8. **Use `?mobile=1`** URL param to force mobile in dev (MobilePreviewContext).

9. **Token Detail = iframe**: don't build as native research page without Phase 5 decision.

10. **Check existing components/mobile/ FIRST**: 6 shared components already exist — don't rebuild.

11. **Prove patterns on real pages, THEN extract.** MobileDataTable was deferred until after Discover for exactly this reason.

12. **Extend existing systems, don't create parallel ones.** CopyToastContext gets enhanced, not replaced.

13. **Test on real devices** at two checkpoints: after Phase 1D (Welcome complete) and after Phase 6C (batch rollout complete). Desktop Chrome DevTools can't catch safe area, keyboard, or touch event issues.

14. **Heavy rendering pages** (Remotion, Three.js, canvas heatmaps) need mobile fallbacks, not just CSS responsive. Disable or replace with static previews.

---

*Plan v4 — final corrections from Claude Code codebase analysis*
*Target: 37 research pages + 3 trading views*
*Key principle: audit → prove on real pages → extract → propagate*
*Shell is inline in app-shell.jsx | 6 shared components exist in components/mobile/*
*usePullToRefresh needs creation | Binance streaming in progress | Cinema mode → disable on mobile*
*Heavy pages (Remotion/Three.js/canvas) → static fallback | RTL deferred | 10-12 rollout batches*
*CSS prefix migration deferred (low ROI) | CopyToastContext extended, not replaced*
