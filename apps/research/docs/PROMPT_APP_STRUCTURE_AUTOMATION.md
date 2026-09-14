# AI Workflow Automation – App Structure

Use this prompt (or a variant) with Cursor, a CLI agent, or any AI that has access to your repo. It assumes the app is **Spectre Vibe** (React + Vite, Research Zone, WelcomePage, token view, etc.).

---

## Prompt A: “Document / update app structure”

Copy-paste this (optionally after replacing `docs/APP_STRUCTURE.md` with your target file):

```
Using the Spectre Vibe codebase:

1. Read docs/APP_STRUCTURE.md (canonical app structure).
2. Parse src/App.jsx for all conditional branches on currentPage and currentView, and list which component or layout each branch renders.
3. Parse src/components/NavigationSidebar.jsx for the full list of navigation items (id, label).
4. Update docs/APP_STRUCTURE.md so it accurately reflects:
   - Every route (currentPage + currentView) and what it renders
   - All subpages and their component paths
   - Which nav items are implemented vs placeholder
   - The file map under src/ (components, hooks, services, icons)
5. Keep the same markdown sections and table format; only fix or add content. If a new page or nav item was added in code, add it to the doc. If something was removed, remove it from the doc.
```

---

## Prompt B: “Generate a one-page structure summary”

```
Using docs/APP_STRUCTURE.md and the Spectre Vibe codebase:

Produce a single-page structure summary suitable for onboarding or AI context. Include:
- Entry point and shell (main.jsx, App, Header, Nav, etc.)
- All routes: (currentPage, currentView) → what renders
- List of all subpages with component path and one-line description
- List of nav items with id, label, and whether implemented
- Shared layout (token view: LeftPanel | Center | RightPanel)
Output in markdown. Keep it under 120 lines.
```

---

## Prompt C: “Check consistency (structure vs code)”

```
Using docs/APP_STRUCTURE.md:

1. For each route and subpage listed in APP_STRUCTURE.md, verify in src/App.jsx and the components folder that the corresponding component exists and is rendered for that route.
2. For each nav item in APP_STRUCTURE.md, verify it exists in src/components/NavigationSidebar.jsx with the same id.
3. Report any mismatch: doc says X but code does Y, or code has Z but doc doesn’t mention it. Suggest concrete edits to APP_STRUCTURE.md to fix.
```

---

## Prompt D: “Use structure to generate [X]”

Replace `[X]` with your goal (e.g. “E2E test outline”, “sitemap”, “breadcrumbs config”).

```
Using docs/APP_STRUCTURE.md as the source of truth for Spectre Vibe app structure (all routes, views, subpages, nav items):

Generate [X]. Reference the doc for:
- Every user-visible route (currentPage + currentView)
- All subpages and their components
- Which nav items are implemented

[Add any extra constraints, e.g. “output as JSON” or “one test file per full page”.]
```

---

## Script: Dump structure (optional)

A small Node script can dump routes and nav items so automation doesn’t depend on parsing JSX by hand. Example (run from repo root):

**scripts/dump-app-structure.mjs**

```js
#!/usr/bin/env node
/**
 * Dump Spectre Vibe app structure from App.jsx and NavigationSidebar.
 * Usage: node scripts/dump-app-structure.mjs
 * Output: JSON to stdout (or pipe to docs/app-structure.json).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const appPath = path.join(root, 'src/App.jsx')
const navPath = path.join(root, 'src/components/NavigationSidebar.jsx')

const app = fs.readFileSync(appPath, 'utf8')
const nav = fs.readFileSync(navPath, 'utf8')

// Extract nav items: { id: '...', label: '...' }
const navItems = []
const navRe = /\{\s*id:\s*['"]([^'"]+)['"]\s*,\s*label:\s*['"]([^'"]+)['"]/g
let m
while ((m = navRe.exec(nav)) !== null) navItems.push({ id: m[1], label: m[2] })

// Extract currentPage branches: currentPage === 'xxx' ? ... : 
const pages = []
const pageRe = /currentPage\s*===\s*['"]([^'"]+)['"]\s*\?\s*\(?[\s\S]*?\)\s*:\s*(?=currentPage|currentView|<>)/g
let p
while ((p = pageRe.exec(app)) !== null) pages.push(p[1])
// Also catch final currentView === 'welcome' and else (token)
if (app.includes("currentView === 'welcome'")) pages.push('welcome-view')
if (app.includes('currentView === \'token\'') || app.includes('main-layout')) pages.push('token-view')

const out = {
  generatedAt: new Date().toISOString(),
  navItems,
  pagesFromConditionals: [...new Set(pages)],
  note: 'Parse App.jsx manually for exact component per route; see docs/APP_STRUCTURE.md',
}
console.log(JSON.stringify(out, null, 2))
```

---

## How to run the script

1. Create the file:

   `scripts/dump-app-structure.mjs`

   with the content above.

2. Run (from repo root):

   ```bash
   node scripts/dump-app-structure.mjs
   ```

3. Optional: write to a JSON file for other tools:

   ```bash
   node scripts/dump-app-structure.mjs > docs/app-structure.json
   ```

---

## Summary

| Artifact | Purpose |
|----------|---------|
| **docs/APP_STRUCTURE.md** | Single source of truth for routes, views, subpages, components. |
| **docs/PROMPT_APP_STRUCTURE_AUTOMATION.md** | This file: prompts and optional script for AI workflow automation. |
| **Prompt A** | Update APP_STRUCTURE.md from code. |
| **Prompt B** | Generate a short structure summary. |
| **Prompt C** | Check doc vs code consistency. |
| **Prompt D** | Use structure to generate tests, sitemap, etc. |
| **scripts/dump-app-structure.mjs** | Optional: dump nav + pages as JSON. |

Use **Prompt A** after adding/removing pages; use **Prompt C** before releases. Use **Prompt D** with your own goal (e.g. “generate Playwright test outline for all subpages”).
