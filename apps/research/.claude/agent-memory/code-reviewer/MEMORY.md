# Code Reviewer Agent Memory

## Confirmed Project Patterns

### react-grid-layout v2 (2.2.2)
- Named exports in use: `ResponsiveGridLayout`, `useContainerWidth`, `verticalCompactor` — all confirmed valid
- CSS import: `react-grid-layout/css/styles.css` — resolves correctly from node_modules
- Both TC and YOU pages use `dragConfig={{ handle: '...' }}` and `compactor={verticalCompactor}`

### CSS Custom Properties Defined in index.css
- `--font-display`, `--font-body`, `--font-mono` — all defined
- `--font-glass` — legacy alias for `--font-body`
- `--font-cinema` — NOT defined anywhere in source; silently falls back to browser default serif
- `--radius-xl` = 24px, `--radius-lg` = 16px, `--radius-sm` defined
- `--bg-surface`, `--bg-elevated`, `--bg-hover`, `--bg-overlay` — defined
- `--bull`, `--bear`, `--border-accent`, `--border-default`, `--border-strong` — defined

### Cross-Page CSS Dependencies (Known Pattern)
- YOU page `AddWidgetPanelYou` uses `tc-add-*` CSS class names from TradersCorner.css
- TradersCorner.css is lazy-loaded only when TC page is visited
- SpectreYou.css only provides overrides (z-index, border-radius) for those classes
- The base `tc-add-*` styles will be MISSING if user visits /you before visiting /traders-corner

### Lazy Loading Pattern
- All pages except HomePage are `React.lazy()` — standard across the app
- Each page imports its own CSS inside the page file (not globally)

### State Architecture
- localStorage keys for YOU: `spectre:you-layout`, `spectre:you-widgets`, `spectre:you-version`
- Zustand handles persisted user prefs; page-local layout uses raw localStorage (consistent with TC pattern)

### Dead Code
- Previous `isInitial` ref note is now stale — superseded by v2 layout upgrade

### Widget Cross-Import Pattern
- YOU registry imports directly from `../traders-corner/widgets/` — this is a cross-page import
- Not against monorepo rules (no cross-*app* imports), but violates folder-per-page isolation principle
- All 23 TC widget files confirmed to exist at those paths (verified Feb 2026)

### YOU Page v2 Layout (version bump to 2)
- Default layout has 15 widget entries, NOT 16 as claimed in file comment header
- localStorage version migration has a race condition: useState initializers run BEFORE useEffect,
  so on first load after a version bump the old stale data is read, then cleared, but React has
  already initialized state with the stale values. On the NEXT render the state is still stale.
- CSS custom property `--accent` is defined in index.css as #f5f5f7 (near-white), so the active
  filter button background in AddWidgetPanelYou will appear white/silver, not purple — may be intentional
- Sticky toolbar uses `top: 0` — works correctly because page-layout.css sets `overflow-y: auto` on
  the scroll container, making `top: 0` stick to the scroll viewport top, not the document top
- AddWidgetPanelYou panel CSS is now fully self-contained in SpectreYou.css (`.you-page .tc-add-*`)
  — the previous cross-CSS dependency on TradersCorner.css is RESOLVED in this upgrade
- Staggered animation delay selectors go to :nth-child(16) but actual default layout only has 15 items
  — 16th selector is dead CSS (harmless)
- `--font-cinema` is locally redefined inside `.you-page {}` rule as a fallback serif stack —
  this resolves the missing token issue noted previously for this page only
