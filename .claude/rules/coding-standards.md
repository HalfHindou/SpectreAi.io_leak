# Coding Standards

---

## A. Language Rules

- **No TypeScript** in app code - use `.jsx` and `.js` files only
- `packages/spectre-ui/` is the sole exception - it uses TypeScript (`.tsx`, `.ts`)
- **Plain CSS** with component-paired stylesheets (`Component.jsx` + `Component.css`)
- **CSS custom properties** for all design tokens (defined in each app's `src/index.css`)
- React 18 functional components with hooks - no class components (exception: error boundaries)
- Keep components focused - one responsibility per file

---

## B. Key Libraries

- **Research app**: react-router-dom v7, Zustand v5, Framer Motion, Remotion, i18next
- **Trading app**: TradingView Lightweight Charts, Three.js/R3F, Framer Motion, lucide-react
- **Both apps**: React 18, Vite 5, plain CSS

---

## C. Import Aliases

- Research app uses `@` -> `src/` path alias (configured in `vite.config.js` + `jsconfig.json`)
  - `import Foo from '@/components/Foo'` - NOT `../components/Foo`
  - Only exception: same-directory siblings stay relative
- Trading app does NOT use `@` alias - uses default relative imports
- **CSS files** cannot use `@/` - use relative paths: `@import '../../../components/shared.css'`

---

## D. Icon Systems (differ by app)

- **Research app**: custom `spectreIcons.jsx` (50+ SVG icons in `src/icons/`)
- **Trading app**: `lucide-react` (^0.563.0)
- **Mobile-only components**: inline SVG with explicit width/height (avoids importing full icon library)

---

## E. Workspace Conventions

- Each app has its own `package.json`, `vite.config.js`, and dev/build scripts
- Shared packages live in `packages/` and are referenced by workspace name (e.g., `@spectre/ui`)
- Environment variables go in `.env` at the monorepo root
- The shared server reads `.env` from the monorepo root automatically
- Both apps proxy `/api` requests to the shared server (port 3001) via Vite dev server
- **No cross-app imports** - apps never import from each other, only from shared packages
- **Tests: vitest, run in CI.** Root `npm test` runs `vitest run` over
  `apps/**/tests/**/*.test.{js,jsx}` (see `vitest.config.js`); the `test` GitHub
  workflow runs it on every PR to `main`. Write tests for new pure logic - the
  glob picks up anything you drop in `apps/<app>/tests/`.
  🪤 Files under `**/__tests__/**.test.mjs` are NOT vitest and are NOT in the CI
  glob - they are standalone scripts run with plain `node <file>` (each has a
  `Run:` line in its header). If you add one, nothing runs it automatically.

---

## F. Page & Component Structure

### Page Directory Convention

Every page follows a two-level structure:

```
src/pages/{kebab-name}/
  index.jsx           # Thin wrapper: reads stores/contexts, passes props down
  components/
    {kebab-name}.jsx  # Actual UI implementation
    {kebab-name}.css  # Main styles
    {kebab-name}.day-mode.css    # Day mode overrides
    {kebab-name}.mobile.css      # Mobile overrides
    {kebab-name}.cinema-mode.css # Cinema mode (if applicable)
    use-{name}.js     # Page-specific hooks
    {name}-constants.js  # Page-specific constants
```

- `index.jsx` contains NO UI markup - it pulls state from Zustand/Context and passes flat props
- All JSX lives in the `components/` subfolder
- Page-specific constants go in the page's `components/` folder, NOT in `src/constants/`

### File Naming

- **Components**: kebab-case (`welcome-page.jsx`, not `WelcomePage.jsx`)
- **CSS**: paired with component (`welcome-page.css` alongside `welcome-page.jsx`)
- **CSS splits**: separate files per concern: `.day-mode.css`, `.mobile.css`, `.cinema-mode.css`
- **Hooks**: `use-{name}.js` (kebab-case file, camelCase export)

### CSS Class Naming

Each component has a unique 2-4 letter prefix that namespaces all its classes:

```
cab-  = Calendar/Brief tab
intel- = Intelligence page
gm-dashboard- = GM Dashboard
tc-   = Traders Corner
mws-  = MobileWatchlistStrip
mct-  = MobileContentTabs
```

BEM (`__element`, `--modifier`) is used selectively (intelligence page), not universally. What IS universal: the short prefix prevents class collisions without requiring BEM everywhere.

### Conditional CSS Classes

No `classnames`/`clsx`. Template literals: `` className={`intel-pill${active ? ' intel-pill--active' : ''}`} ``

---

## G. Component Patterns

### Exports

- **Default exports** for page/UI components. **Named exports** for utilities, hooks, constants.

### Lazy Loading

All pages lazy-loaded with `fallback={null}` (previous page stays visible).

### Error Boundaries (three levels)

1. **App-level** (`AppErrorBoundary` in `main.jsx`) - plain HTML fallback
2. **Page-level** (`PageErrorBoundary`) - wraps every `<Route>`, keeps sidebar/header
3. **Feature-level** (inline class components) - Privy, TradingView

Error boundaries are class components in `index.jsx` wrapper, not inside functional components.

---

## H. Hook Patterns

### Return Values

Hooks return plain objects (`{ data, loading }`), never arrays.

### Data Fetching

Background hooks: `let cancelled = false` cleanup (NOT AbortController). AbortController only for user-triggered searches.

### Visibility-Aware Polling

Skip fetches when `document.hidden`. Use `useVisibilityAwareInterval` hook or inline guard.

### Stable Keys

Unstable dep arrays → compute stable key string: `symbols.join(',')` then use in `useMemo` deps.

### useRef for Unstable External Refs

SDK functions that change each render (Privy, wallet) → store in `useRef` to prevent effect loops.

---

## I. Routing

### Route IDs

Navigate by ID via `getPathForPageId('ai-screener')` from `pageRoutes.js`, never hardcode paths.

### Layout Tiers

- **Standalone** (no AppShell): `/newsroom`, `/website`
- **AppShell only** (no PageShell): `/token`, `/gm-dashboard`, `/monarch-chat`
- **AppShell + PageShell**: all other routes (wrapped in `<PageErrorBoundary>`)

---

## J. i18n

- `useTranslation` imported only in leaf components where translation is needed
- Inner components often receive `t` as a prop rather than calling `useTranslation()` themselves
- Language stored in Zustand, but i18n initializes by reading raw localStorage (before React mounts)
- **20 languages, and only English is eager.** `i18n/index.js` statically imports
  `en.json` alone; every other locale is dynamic-imported per language, so a
  visitor downloads one language, not twenty. `en.json` itself is only the shell
  and home strings - the page-specific half lives in `en-rest.json` and is
  dynamic-imported on the idle tick. Adding a string to `en.json` puts it in the
  entry chunk that every user pays for; prefer `en-rest.json` unless the shell
  needs it at first paint.
- RTL support: `document.documentElement.dir` set on language change

---

## K. Animations

- **Default choice**: CSS keyframes and transitions (from animation catalog in `design-system.md`)
- **Framer Motion**: only when JavaScript-driven logic is required (sequence coordination, scroll-linked transforms, `AnimatePresence` for exit animations)
- Framer Motion is used only in `research-zone` components and one shared container-scroll component
- Do NOT add Framer Motion to new components unless CSS transitions are insufficient

---

## L. Formatting & Currency

Use `useCurrency()` bound formatters (`fmtPrice`, `fmtLarge`), never raw `formatPrice()` directly (bypasses user's currency). Exception: USD-only widgets (Binance data).

All numbers/prices/percentages in `var(--font-mono)` via `.mono` class.

**Exception - website2 landing page**: website2 uses `Geist` (sans-serif) for ALL text including numbers. Never use `JetBrains Mono`, `var(--font-mono)`, or any monospace font on website2. See `design-system.md` section L.

---

## M. Image & Asset Handling

- **App logos**: in `public/`, referenced by absolute path string (`<img src="/round-logo.png" />`)
- **Token logos**: from CoinGecko API data (`coin.image.small`), NOT local files
- **Fallback**: `onError` handler that replaces with default logo
- Do NOT `import` images from `src/assets/` for app chrome - use `public/` paths

---

## N. Auth Gate

`AuthGate` uses `sessionStorage` (team password), NOT Privy or JWT. Bypassed automatically on localhost/dev environments via `isDevBypass` (checked at module level to avoid flash of password screen).

Privy is optional and separate from AuthGate. See `solana-web3.md` section K.

---

## O. Constants Organization

```
src/constants/
  majorTokens.js     # 38 major tokens, SYMBOL_TO_COINGECKO_ID, isMajorToken()
  pageRoutes.js      # PAGE_PATHS map, getPathForPageId(), getPageIdFromPath()
  stockData.js       # Stock sectors and data
  tokenColors.js     # 200+ token brand colors, getTokenRowStyle()
```

Constants used by only ONE page live in that page's `components/` folder. Do not pollute `src/constants/` with page-specific data.

---

## P. Things Agents Get Wrong

| Mistake | Correct Pattern |
|---------|----------------|
| Put business logic in `pages/X/index.jsx` | Logic goes in `pages/X/components/` |
| Create one CSS file per page | Split: `.css`, `.day-mode.css`, `.mobile.css` |
| Use `@import '@/...'` in CSS files | CSS only supports relative paths |
| Return arrays from custom hooks | Always return objects |
| Use `classnames`/`clsx` library | Template literals with leading space in conditional |
| Import `posthog-js` directly | Use `@/services/analytics` wrapper |
| Call `formatPrice()` directly | Use `useCurrency()` bound formatters |
| Hardcode route paths in navigate() | Use `getPathForPageId()` from pageRoutes |
| Put page-specific constants in `src/constants/` | Put in page's own `components/` folder |
| Add Framer Motion to new components | CSS transitions first, Framer Motion only if needed |
| `import logo from './logo.png'` | Use `public/` path: `src="/logo.png"` |
| Create class-based components | Functional only (exception: error boundaries) |
| Use `JetBrains Mono` / `var(--font-mono)` on website2 | Website2 uses `Geist` for ALL text including numbers |
