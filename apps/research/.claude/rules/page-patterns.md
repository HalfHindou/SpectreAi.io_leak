# Research App — Page Patterns

## Folder-per-Page Structure (~68 folders)
- Every page is a folder: `src/pages/{kebab-name}/index.jsx` + `components/` subfolder
- Folder/file names use **kebab-case**: `src/pages/market-analytics/`, NOT `MarketAnalytics/`
- Page wrappers (`index.jsx`) pull state from contexts + Zustand store, pass as props to components
- Page-specific components live in `src/pages/{page-name}/components/` — NEVER in `src/components/`

## Import Rules
- **Always use `@/` path alias** for cross-directory imports — `@` maps to `src/` (configured in `vite.config.js` + `jsconfig.json`)
  - `import Foo from '@/components/Foo'` — NOT `../components/Foo`
  - `import useSettingsStore from '@/store/useSettingsStore'` — NOT `../../store/useSettingsStore`
- **Only exception:** same-directory sibling imports stay relative (`./EggHelpers`, `./App`)
- **CSS `@import`** uses relative paths (e.g. `../../../components/X.css`), NOT `@/` alias

## Shared vs Page-Specific
- Shared components (used by 2+ pages) → `src/components/` — imported as `@/components/X`
- Page-specific components → `src/pages/{page-name}/components/` — imported as `./components/X`
- Moving to shared? Only if used by 2+ pages — move to `src/components/` and update all imports

## State Management
- **Zustand `useSettingsStore`** for all persisted user preferences — never use raw `localStorage.getItem/setItem`
- Use selectors for granular re-renders: `useSettingsStore((s) => s.dayMode)`
- **Contexts** for transient/domain state only (AppState, I18nCurrency, Watchlists, SpectreAgent, CopyToast)

## New Page Checklist
1. Create `src/pages/{kebab-name}/index.jsx` + `components/` subfolder
2. Add route in `App.jsx`
3. Import as `@/pages/{kebab-name}`
4. Find the most similar existing page and match its layout patterns
