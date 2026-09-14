---
description: Scan codebase for tech debt, dead code, duplicated patterns, and architecture violations
argument-hint: "[research|trading|server|all]"
---

Scan the Spectre AI monorepo for tech debt. Scope: $ARGUMENTS (default: all).

## What to Scan

### 1. Dead Code
- Exported functions/components never imported anywhere
- CSS classes defined but never referenced in JSX
- Known dead code: `ChainVolumeBar`, `AIAssistant`, `ResearchPage`, `CURATED_TOKENS` const in server
- Files in `src/pages/` with no route in `App.jsx`
- Unused npm dependencies (package.json vs actual imports)

### 2. Duplicated Patterns
- Components reimplemented in both apps instead of shared via `@spectre/ui`
- API call logic duplicated between Express server and Vercel serverless functions
- Token registry/mapping data duplicated across server + serverless files
- Identical CSS patterns that should be extracted to shared variables

### 3. Code Quality
- `console.log` statements in production code (not wrapped in dev-only checks)
- TODO/FIXME/HACK comments
- Functions longer than 100 lines
- Files longer than 500 lines (excluding the known server monolith)
- Catch blocks that swallow errors silently

### 4. Architecture Violations
- Cross-app imports (research importing from trading or vice versa)
- TypeScript files in app code (only allowed in `packages/spectre-ui/`)
- Inline styles instead of CSS custom properties
- Missing day mode counterparts for dark mode styles

## Execution
Use parallel subagents to scan different areas simultaneously. Aggregate and deduplicate results.

## Output Format

```
# Tech Debt Report - [date]

## Critical (blocks production quality)
- [file:line] Description

## Warning (should fix soon)
- [file:line] Description

## Cleanup (low priority)
- [file:line] Description

## Stats
- Dead code files: X
- Duplicated patterns: X
- Console.logs in prod: X
- Silent error catches: X
```
