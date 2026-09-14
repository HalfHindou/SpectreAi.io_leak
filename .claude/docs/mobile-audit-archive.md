# Mobile Implementation Audit Archive

> Completed audit phases from the mobile responsive rollout. Moved from `mobile-design-system.md` to reduce file size.
> These sections document completed work - reference only if investigating what was done during initial mobile buildout.

---

## P. Implementation Status - Phase 0A Audit

**Audit date:** 2026-03-26
**Scope:** Read-only file inventory across research + trading apps

### Mobile Shell Architecture (app-shell.jsx - 366 lines)

All mobile shell components are extracted to separate files. app-shell.jsx only manages state (3 booleans) and conditional rendering.

| Component | File | Lines in app-shell | Notes |
|-----------|------|--------------------|-------|
| Mobile Header | `src/components/mobile-header.jsx` + `.css` (956 lines CSS) | 235-262 | 52px, hamburger/logo/tools |
| Mobile Bottom Nav | `src/components/mobile-bottom-nav.jsx` + `.css` (789 lines CSS) | 308-334 | 76px, 4+1 Robinhood |
| Side Drawer | `src/components/side-drawer.jsx` | 264-282 | Mobile navigation panel |
| Settings Panel | `src/components/mobile-settings-panel.jsx` + `.css` (483 lines CSS) | 285-303 | Right-side drawer |
| Preview Frame | `src/components/mobile-preview-frame.jsx` + `.css` (247 lines CSS) | 355-365 | iPhone frame for `?mobile=1` |
| Search Overlay | `src/components/mobile-search-overlay.jsx` + `.css` (647 lines CSS) | - | Fullscreen mobile search |
| Subpage Header | `src/components/mobile-subpage-header.jsx` + `.css` (185 lines CSS) | - | Back button + title |
| Navigation | `src/components/mobile-navigation.jsx` | - | Subpage stack context |

### Shared Mobile Components (src/components/mobile/ - 6 components, 12 files)

| Component | CSS | Purpose | Row Height |
|-----------|-----|---------|------------|
| `digit-morph.jsx` | `digit-morph.css` | Price digit-by-digit animation | - |
| `skeleton-row.jsx` | `skeleton-row.css` | Shimmer placeholder | full=64px, compact=56px, minimal=48px |
| `token-bottom-sheet.jsx` | `token-bottom-sheet.css` | 75dvh slide-up detail sheet | - |
| `token-row-compact.jsx` | `token-row-compact.css` | Watchlist rows, swipe-to-remove | 56px |
| `token-row-full.jsx` | `token-row-full.css` | Market list with rank + sparkline + mcap | 64px |
| `token-row-minimal.jsx` | `token-row-minimal.css` | Search results, bottom sheets | 48px |

### Welcome Page Mobile Components (pages/home/components/ - 10 files)

| File | CSS Prefix | Hooks Imported | Lines | Paired CSS |
|------|-----------|----------------|-------|-----------|
| `mobile-home-tab.jsx` | `mh-` | memo, useCallback, useState | 575 | `mobile-home.css` (1253 lines) |
| `mobile-content-tabs.jsx` | `mct-` | memo, useRef, useCallback, useLayoutEffect, useMemo, useState | 265 | `mobile-content-tabs.css` (314 lines) |
| `mobile-discovery-section.jsx` | `mds-` | memo, useRef, useCallback, useLayoutEffect, useMemo, useState | 304 | `mobile-discovery-section.css` (385 lines) |
| `mobile-highlights-tabs.jsx` | `mht-` | memo, useState, useMemo, useCallback, useRef | 243 | `mobile-highlights-tabs.css` (379 lines) |
| `mobile-token-row.jsx` | `mtr-` | useState, useMemo, useCallback, useId | 403 | `mobile-token-row.css` (552 lines) |
| `mobile-token-list.jsx` | `mtl-` | useState, useMemo, useCallback, memo | 270 | `mobile-token-list.css` (240 lines) |
| `mobile-market-pulse.jsx` | `mmp-` | useCallback | 219 | `mobile-market-pulse.css` (309 lines) |
| `mobile-watchlist-strip.jsx` | `mws-` | useCallback | 244 | `mobile-watchlist-strip.css` (447 lines) |
| `mobile-quick-stats.jsx` | `mobile-quick-stat-` (non-standard) | memo, useMemo | 190 | `mobile-quick-stats.css` (244 lines) |
| `mobile-brief-card.jsx` | `mobile-brief-` (non-standard) | memo | 104 | `mobile-brief-card.css` (293 lines) |

### Other Page Mobile Components (2 files)

| File | Path | Purpose |
|------|------|---------|
| `mobile-tab-bar.jsx` + `.css` (222 lines) | `pages/research-zone/components/` | Glass tab bar, 3 variants (default/compact/pills) |
| `mobile-bottom-sheet.jsx` + `.css` (255 lines) | `pages/watchlists/components/` | iOS-style bottom sheet with snap points |

### Hooks Status

| Hook | Exists | Imported By | Status |
|------|--------|-------------|--------|
| `useMediaQuery.js` / `useIsMobile()` | YES | 7 files | **Active** - core responsive detection |
| `useSwipeNavigation.js` | YES | 1 file (mobile-content-tabs) | **Active** |
| `usePullToRefresh.js` | YES | 1 file (welcome-page) | **Created** in Phase 1B |
| `useAdaptivePolling.js` | YES | **51 files** | **Heavily active** - core perf hook |
| `useBinanceStream.js` | YES | 0 files | **Orphaned** - implemented, never imported |
| `useInViewport.js` | YES | 0 files | **Orphaned** - implemented, never imported |
| `MobilePreviewContext` | YES | 3 files | **Active** - `?mobile=1` dev tool |

### CSS File Inventory

| Category | Files | Total Lines | Key Files |
|----------|-------|-------------|-----------|
| Global tokens | 1 | 5,963 | `src/styles/mobile-2026.css` |
| Shell components | 6 | 3,307 | mobile-header, bottom-nav, search-overlay, settings-panel, preview-frame, subpage-header |
| Welcome page | 12 | 6,675 | 10 component CSS + welcome-page.mobile.css (495) + mobile-home.css (1253) |
| Other pages | 2 | 477 | watchlists/mobile-bottom-sheet, research-zone/mobile-tab-bar |
| Cinema mode | 1 | 4,865 | welcome-page.cinema-mode.css (editorial variant) |
| **Total** | **22** | **~21,287** | |

### Trading App Findings

| Question | Answer |
|----------|--------|
| CSS files with @media | 27 files |
| Unique breakpoints | 15: 420, 480, 500, 600, 640, 768, 900, 960, 1000, 1024, 1100, 1200, 1300, 1400, 1600px |
| `useBinanceStream.js` | YES - exists in hooks/ |
| `binanceStreamService.js` | YES - exists in services/ |
| Mobile-specific files | **NONE** - no mobile-*.jsx, no *.mobile.css |
| `useIsMobile` / `useMediaQuery` | **Neither exists** - must be added in Phase 5A |
| Hooks total | 10 hooks in hooks/ |
| Services total | 8 services in services/ |

### Issues Flagged

1. **Bug:** `mobile-market-pulse.jsx` uses `useMemo` (line 134) without importing it
2. **Orphaned hooks:** `useBinanceStream` + `useInViewport` - fully implemented, zero imports anywhere
3. **~~Missing hook:~~ `usePullToRefresh`** - CREATED in Phase 1B, wired into Welcome page
4. **Trading app gap:** No JS mobile detection, no mobile-specific files, 15 scattered breakpoints
5. **CSS prefix inconsistency:** 2 of 10 Welcome components use long-form prefixes (`mobile-brief-`, `mobile-quick-stat-`) - migration deferred (low ROI)
6. **Day mode inconsistency:** Some CSS files use `.day-mode` suffix instead of BEM `--day` convention

---

## Q. Implementation Status - Phase 0B CSS Token Audit

**Audit date:** 2026-03-26
**Scope:** Verify `mobile-2026.css` tokens, extend utilities, check import chain

### Token Verification

| Token | Expected | Actual (line) | Status |
|-------|----------|---------------|--------|
| `--m-bottom-nav-h` | `76px` | `76px` (L43) | PASS |
| `--m-content-pad` | `8px` | `8px` (L44) | PASS |
| `--m-xs` | `4px` | `4px` (L22) | PASS |
| Font prefix | `--m-text-*` | `--m-text-xs` through `--m-text-hero` (L31-39) | PASS |
| Anti-wobble globals | Present | `html`, `body`, `#root`, `.app` locked (L59-96) | PASS |
| Desktop conflicts | None | `src/index.css` has zero `--m-*` tokens | PASS |
| Import chain | Top-level | `main.jsx` L19: `import '@/styles/mobile-2026.css'` - not nested | PASS |

### Breakpoints Used in mobile-2026.css

| Breakpoint | Query | Count | Purpose |
|------------|-------|-------|---------|
| Mobile | `max-width: 768px` | ~55 blocks | Primary mobile styles |
| Small mobile | `max-width: 375px` | 1 block | Compact overrides, `--m-content-pad: 12px` |
| Tablet | `769px - 1024px` | 1 block | Sidebar collapse |
| Landscape | `768px + orientation: landscape` | 1 block | Compact bottom nav |
| PWA | `display-mode: standalone` | 1 block | Safe area + header padding |
| Reduced motion | `768px + prefers-reduced-motion: reduce` | 1 block | Kill animations |
| Touch | `hover: none` (nested inside 768px) | 1 block | Disable hover effects |

### Utility Classes Added

Added to end of `mobile-2026.css` inside `@media (max-width: 768px)`:

| Class | Purpose |
|-------|---------|
| `.m-stack` | Vertical flex column, `gap: var(--m-md)` (12px) |
| `.m-stack--tight` | Same, `gap: var(--m-sm)` (8px) |
| `.m-stack--loose` | Same, `gap: var(--m-lg)` (16px) |
| `.m-touch-target` | `min-height: 44px; min-width: 44px` (Apple HIG) |
| `.m-sticky-bottom` | Fixed position above bottom nav with safe area |
| `.m-safe-area` | `padding-bottom: env(safe-area-inset-bottom)` |

### Notable Findings

1. **Small mobile breakpoint**: Code uses `375px` (L2006), design system doc section A says `380px`. The `375px` value is correct (matches iPhone SE viewport width).
2. **File size concern**: `mobile-2026.css` is 5,963 lines. Contains Welcome page-specific overrides (~3,000 lines) mixed into the global token file.
3. **No global utility classes existed** before this phase.
4. **Reduced motion support** exists (L4582-4593).
5. **PWA three-layer safety net**: `@media (display-mode: standalone)` + `@supports (-webkit-touch-callout: none)` for iOS + `.pwa-standalone` JS-detected class.

---

## R. Implementation Status - Phase 0C Page Inventory

**Audit date:** 2026-03-26
**Scope:** Route inventory, mobile readiness assessment, rollout categorization

### Summary

- 40 total routes, 1 with full mobile implementation (Welcome), 2 with partial mobile components
- 14 simple pages, 15 medium, 11 complex
- Desktop-only candidates: `/world` (WebGL), `/x-intelligence` (social graph), `/structure-guide`, `admin`
- Full inventory in `.claude/rules/responsive-rollout-plan.md`

---

## S. Implementation Status - Phase 0D Mobile Shell Verification

**Audit date:** 2026-03-26
**Result:** All PASS. Mobile shell ready for page work. No blocking issues.

- MobileHeader: 52px fixed top, safe area, day mode (40+ rules), CSS + JSX guards
- MobileBottomNav: 62px + padding fixed bottom, safe area, day mode (30+ rules), JSX guard only
- MobileSettingsPanel: Full height right drawer, safe area, day mode (20+ rules)
- SideDrawer: Full height left drawer
- `?mobile=1` preview mechanism working correctly

---

## T. Implementation Status - Phase 1A Day Mode Audit

**Audit date:** 2026-03-26
**Result:** 12 rules added across 3 files. All 10 Welcome page mobile components now have complete day mode coverage.

Key decisions:
- AI Brief stays dark in day mode
- No `@media` scoping needed on day mode rules (JSX guards sufficient)
- Bull/bear bg opacity: 0.08 dark -> 0.12 light

---

## U. Implementation Status - Phase 1C Welcome Page Cleanup & QA

**Audit date:** 2026-03-26
**Result:** All QA checks PASS.

- 7 blur violations fixed (max blur now 12px on mobile)
- ~164 hardcoded values replaced with tokens across 12 CSS files
- @media guard added to mobile-home.css container rules
- Known accepted: sub-token font-sizes, CSS scoping on 4 files (safe via JSX guards)
