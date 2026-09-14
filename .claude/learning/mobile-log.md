# Mobile Design System — Build Log

Chronological log of bugs, fixes, patterns, and decisions made during mobile responsive design.
Entries here get promoted to `rules/mobile-design-system.md` (patterns) or `corrections.md` (bugs) once proven.

Format: `### YYYY-MM-DD — [BUG|FIX|PATTERN|DECISION] Short title`

---

### 2026-03-17 — FIX: Stats chips row wrapping 4+1 on mobile
- **File:** `welcome-page.mobile.css` lines 305-330
- **Problem:** `.cab-tab-chips` (BriefTabContent stats) used `flex-wrap: wrap` — 5 chips (F&G, Bias, BTC, ETH, SOL) fit 4 on row 1, SOL orphaned on row 2.
- **Root cause:** Desktop layout assumed enough width for all chips. Mobile override enforced wrapping with `!important`.
- **Fix:** Changed to `flex-wrap: nowrap`, `overflow-x: auto`, hidden scrollbar, `scroll-snap-type: x proximity`. Each chip gets `scroll-snap-align: start`.
- **Pattern:** This is the standard **horizontal scroll strip** pattern from `mobile-design-system.md` Section E2. Applied here for the first time outside a dedicated mobile component.
- **Status:** FIXED

### 2026-03-17 — FIX: Watchlist token logos showing letter fallbacks
- **File:** `mobile-watchlist-strip.jsx` line 58
- **Problem:** TokenCard destructured `image` from token, but `useWatchlistPrices` returns the field as `logo`. Always showed letter fallback (B, E, S).
- **Root cause:** Prop name mismatch — hook uses `logo`, component expected `image`.
- **Fix:** Destructure both `image` and `logo`, use `const tokenImage = image || logo`.
- **Pattern:** When consuming data from hooks that aggregate multiple sources, always check the actual field names. CoinGecko uses `image`, Codex uses `logo` — the hook normalizes to `logo`.
- **Status:** FIXED

### 2026-03-17 — FIX: Watchlist change % not showing
- **File:** `mobile-watchlist-strip.jsx` line 59
- **Problem:** Component used `priceChange24h` but hook returns `change24h`. No percentage badge showed.
- **Root cause:** Same prop name mismatch as logo — different naming conventions between data sources.
- **Fix:** Destructure both, use `const pctRaw = priceChange24h ?? change24h`.
- **Status:** FIXED

### 2026-03-17 — BUG: `spectreIcons.ai` key doesn't exist
- **File:** `welcome-page.jsx` ~line 811
- **Impact:** Silent missing icon in Brief tab of MobileContentTabs
- **Root cause:** `spectreIcons` has `.sparkles` not `.ai`
- **Fix:** Change to `spectreIcons.sparkles`
- **Status:** OPEN

### 2026-03-17 — BUG: `usePullToRefresh` dead code
- **File:** `src/hooks/usePullToRefresh.js`
- **Impact:** Hook created but never imported in `welcome-page.jsx`. CSS for `.mobile-pull-indicator` exists in `welcome-page.mobile.css` but is unreachable.
- **Root cause:** Hook was written but integration was never completed.
- **Fix:** Wire into welcome-page.jsx or delete if not needed.
- **Status:** OPEN

### 2026-03-17 — BUG: `MobileBriefCard` receives unused props
- **File:** `welcome-page.jsx` lines ~774-775
- **Impact:** `topCoinPrices` and `fearGreed` passed but not declared in component signature.
- **Root cause:** Copy-paste artifact from planning phase.
- **Fix:** Remove unused props from caller.
- **Status:** OPEN

### 2026-03-17 — BUG: Day mode class naming inconsistent
- **Files:** `mobile-quick-stats.css`, `mobile-brief-card.css`
- **Impact:** `.component.day-mode` used instead of BEM `.component.component--day`. Inconsistent with newer components.
- **Root cause:** Early components predated the BEM convention decision.
- **Fix:** Standardize to `.component.component--day` across all mobile components.
- **Status:** OPEN

### 2026-03-17 — BUG: Skeleton day mode sibling selector never matches
- **File:** `mobile-token-row.css`
- **Impact:** `.mtr.mtr--day ~ .mtr-skeleton` never matches because skeletons are separate elements, not siblings of `.mtr`.
- **Root cause:** Assumed parent/sibling DOM structure that doesn't exist.
- **Fix:** Add `.mtr-skeleton.mtr--day` class or pass dayMode from parent.
- **Status:** OPEN

### 2026-03-17 — PATTERN: Inline SVG over spectreIcons for mobile
- **Seen in:** `mobile-content-tabs.jsx`, `mobile-brief-card.jsx`, `mobile-bottom-nav.jsx`, `mobile-header.jsx`
- **Why:** Avoids importing full 50+ icon library into every mobile component. Self-contained, tree-shakeable.
- **Promoted to:** `mobile-design-system.md` Section I

### 2026-03-17 — PATTERN: useSwipeNavigation ref-based gesture tracking
- **File:** `src/hooks/useSwipeNavigation.js`
- **Why:** Refs avoid handler recreation on every touch move. 15px dead zone prevents accidental direction commits. Rubber-band at edges.
- **Promoted to:** `mobile-design-system.md` Section F1

### 2026-03-17 — PATTERN: Horizontal scroll strip with scroll-snap
- **File:** `mobile-watchlist-strip.css`
- **Why:** Native-feeling horizontal scroll with snap points. Hidden scrollbar. Edge padding for content bleed.
- **Promoted to:** `mobile-design-system.md` Section E2

### 2026-03-17 — PATTERN: 2x2 stat grid
- **File:** `mobile-quick-stats.css`
- **Why:** Efficient use of mobile width for 4 KPIs. Glass card base with mobile-reduced blur.
- **Promoted to:** `mobile-design-system.md` Section E4

### 2026-03-17 — PATTERN: Token row with expand + inline sparkline
- **File:** `mobile-token-row.jsx`
- **Why:** 64px compact row, tap-to-expand for detail. Inline SVG sparkline subsampled to ~20 points. React.memo for list perf.
- **Promoted to:** `mobile-design-system.md` Section E3

### 2026-03-17 — DECISION: BEM double-dash for day mode convention
- **Choice:** `.component.component--day` over `.component.day-mode`
- **Why:** BEM is the established convention, most newer components already use it, self-documenting.
- **Impact:** 2 existing components (MobileQuickStats, MobileBriefCard) need migration.
- **Promoted to:** `mobile-design-system.md` Section G

### 2026-03-17 — DECISION: 768px as THE mobile breakpoint
- **Choice:** Single primary breakpoint at 768px, 380px for narrow-only fixes.
- **Why:** Consistent with `mobile-2026.css` token scoping. Avoids fragmentation.
- **Promoted to:** `mobile-design-system.md` Section A
