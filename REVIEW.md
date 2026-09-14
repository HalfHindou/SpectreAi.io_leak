# Spectre Code Review Rules

## Always flag:
- console.log in src/ (use console.error for real errors only)
- Inline styles (style={{}}) — use CSS classes with design tokens
- Hardcoded color values in CSS — use var(--token-name)
- Missing error boundaries on new pages
- Missing day mode styles on new CSS files over 20 lines
- Spinner/loading animations that aren't skeleton shimmer
- Numbers rendered without font-mono (JetBrains Mono)
- New files over 500 lines (split before merging)
- fetch() without AbortController in useEffect
- addEventListener without cleanup in useEffect return
- Empty catch blocks
- New npm dependencies without justification

## Deprioritize:
- Import order
- Naming-only comments without runtime risk
- Minor whitespace or formatting

## Architecture rules:
- Pages follow folder structure: src/pages/[Name]/index.jsx + components/
- Shared components in src/components/ only if used by 2+ pages
- All API calls go through services layer, never direct fetch in components
- State: Zustand for persisted preferences, Context for transient/domain state
- Never nest cards inside cards (one-depth card rule)
- Default exports for components, named exports for utilities
- All hooks return objects (not arrays)
- No TypeScript in app code (exception: packages/spectre-ui/)
- CSS custom properties for all design tokens
- No Tailwind, no CSS-in-JS — plain CSS with component-paired files
