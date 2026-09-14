# SPECTRE SURGICAL CLEANUP — Production Hardening for 100K Users

> You are performing a full surgical cleanup and production hardening of the Spectre AI codebase.
> This app is about to face 100,000 users who will poke every route, spam every button, resize every screen, and test every edge case.
> Your job: make this codebase bulletproof without breaking a single thing that works today.

---

## PRIME DIRECTIVES (read these before every phase)

1. **PLAN MODE FIRST.** No code changes in any phase until I explicitly approve.
2. **One change per commit.** Never batch unrelated changes.
3. **`npm run build` after every commit.** If it fails, `git revert HEAD` immediately.
4. **`npm run dev` spot-check after every 5 commits.** Open the app, click through the page you just touched. If something looks wrong, revert and report.
5. **Never combine cleanup with feature work.** This session is surgery only.
6. **Never touch TradingChart.jsx.** It's being replaced by the Lightweight Charts v5 overhaul. Any cleanup time there is wasted.
7. **Never rename API endpoints.** 38 Vercel routes are live. Renaming breaks production.
8. **Never change the visual output.** Users must see exactly the same app before and after. Zero visual regressions.

---

## PHASE 0: SETUP — Install Surgical Tools

### 0A: Pull latest and verify baseline

```bash
git checkout sunny
git pull origin main
npm install
npm run build
```

If build fails, STOP. Report the error. We fix the baseline before anything else.

### 0B: Install analysis tools (devDependencies only)

```bash
npm install --save-dev knip@latest --legacy-peer-deps
npm install --save-dev madge@latest --legacy-peer-deps
npm install --save-dev husky@latest lint-staged@latest --legacy-peer-deps
```

### 0C: Configure knip

Create `knip.json` in project root:

```json
{
  "entry": [
    "src/main.jsx",
    "src/App.jsx",
    "server/index.js",
    "api/**/*.js"
  ],
  "project": [
    "src/**/*.{js,jsx,css}",
    "server/**/*.js",
    "api/**/*.js"
  ],
  "ignore": [
    "src/remotion/**",
    "packages/**",
    "spectre-forge/**",
    ".prompts/**",
    "docs/**",
    "scripts/**",
    "node_modules/**"
  ],
  "ignoreDependencies": [
    "@remotion/cli",
    "@remotion/player",
    "remotion",
    "msedge-tts"
  ]
}
```

### 0D: Configure madge

Test that madge works:

```bash
npx madge --extensions jsx,js --exclude 'node_modules|remotion|spectre-forge' src/main.jsx
npx madge --circular --extensions jsx,js --exclude 'node_modules|remotion|spectre-forge' src/
```

### 0E: Commit tool setup

```bash
git add knip.json package.json package-lock.json
git commit -m "chore: add knip, madge, husky for codebase analysis"
npm run build
```

**GATE: Report to me that all tools installed and build passes. Do not proceed until I confirm.**

---

## PHASE 1: FULL CODEBASE CENSUS (read-only, zero changes)

Run every analysis below and compile ALL results into `CODEBASE_CENSUS.md`.

### 1A: Knip analysis — the real dead code map

```bash
npx knip --reporter compact 2>&1 | tee /tmp/knip-report.txt
npx knip --include files 2>&1 | tee /tmp/knip-unused-files.txt
npx knip --include exports 2>&1 | tee /tmp/knip-unused-exports.txt
npx knip --include dependencies 2>&1 | tee /tmp/knip-unused-deps.txt
```

For each finding, categorize:
- **DEAD FILES** — entire files with zero imports
- **DEAD EXPORTS** — functions/components exported but never imported
- **DEAD DEPENDENCIES** — npm packages in package.json never used
- **DEAD CSS** — stylesheets imported but potentially unused (knip may flag these)

### 1B: Madge analysis — dependency graph and circular deps

```bash
# Circular dependencies (these are bugs waiting to happen under load)
npx madge --circular --extensions jsx,js --exclude 'node_modules|remotion|spectre-forge' src/ 2>&1 | tee /tmp/madge-circular.txt

# Orphan files (no dependents)
npx madge --orphans --extensions jsx,js --exclude 'node_modules|remotion|spectre-forge' src/ 2>&1 | tee /tmp/madge-orphans.txt

# Full dependency count per file
npx madge --extensions jsx,js --exclude 'node_modules|remotion|spectre-forge' src/ --json > /tmp/madge-deps.json
```

### 1C: Size audit — monolith detection

```bash
echo "=== FILES OVER 300 LINES ==="
find src/ server/ api/ \( -name "*.jsx" -o -name "*.js" -o -name "*.css" \) | while read f; do
  lines=$(wc -l < "$f")
  if [ "$lines" -gt 300 ]; then
    echo "${lines} ${f}"
  fi
done | sort -rn

echo ""
echo "=== TOTAL CODEBASE SIZE ==="
find src/ -name "*.jsx" -o -name "*.js" -o -name "*.css" | xargs wc -l 2>/dev/null | tail -1
find server/ -name "*.js" | xargs wc -l 2>/dev/null | tail -1
find api/ -name "*.js" | xargs wc -l 2>/dev/null | tail -1
```

### 1D: Page-by-page health scan

For every page directory in `src/pages/`:

```bash
for pagedir in src/pages/*/; do
  pagename=$(basename "$pagedir")
  index="${pagedir}index.jsx"
  if [ -f "$index" ]; then
    lines=$(wc -l < "$index")
    functions=$(grep -c "function\|const.*=.*=>" "$index" 2>/dev/null)
    imports=$(head -80 "$index" | grep -c "import" 2>/dev/null)
    has_error_boundary=$(grep -c "ErrorBoundary\|error.*boundary\|componentDidCatch" "$index" 2>/dev/null)
    has_loading=$(grep -c "skeleton\|shimmer\|loading\|Skeleton\|Shimmer" "$index" 2>/dev/null)
    has_day_mode=$(grep -c "day-mode\|dayMode\|day_mode" "$index" "$pagedir"*.css 2>/dev/null)
    comp_count=$(find "${pagedir}components/" -name "*.jsx" 2>/dev/null | wc -l)
    echo "$pagename | ${lines}L | ${functions}fn | ${imports}imp | errBound:${has_error_boundary} | loading:${has_loading} | dayMode:${has_day_mode} | subcomps:${comp_count}"
  fi
done
```

### 1E: Production hardening audit

These are the things 100K users will expose:

```bash
echo "=== MISSING ERROR BOUNDARIES ==="
# Pages WITHOUT error boundary protection
for pagedir in src/pages/*/; do
  pagename=$(basename "$pagedir")
  count=$(grep -r "ErrorBoundary\|componentDidCatch" "$pagedir" 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "NO ERROR BOUNDARY: $pagename"
  fi
done

echo ""
echo "=== EMPTY CATCH BLOCKS (silent failures) ==="
grep -rn "catch.*{" src/ server/ --include="*.jsx" --include="*.js" -A1 | grep -B1 "^[^}]*}$\|console\.log\|// " | head -40

echo ""
echo "=== CONSOLE.LOG IN PRODUCTION CODE ==="
grep -rn "console\.log" src/ --include="*.jsx" --include="*.js" | wc -l
grep -rn "console\.log" server/ --include="*.js" | wc -l

echo ""
echo "=== HARDCODED API URLS/KEYS (security risk) ==="
grep -rn "http://localhost\|127\.0\.0\.1\|apikey.*=.*['\"]" src/ --include="*.jsx" --include="*.js" | grep -v node_modules | head -20

echo ""
echo "=== MISSING LOADING STATES (spinners instead of skeletons) ==="
grep -rn "spinner\|Spinner\|spin\|CircularProgress\|loading-spinner" src/ --include="*.jsx" --include="*.css" | head -20

echo ""
echo "=== INLINE STYLES (design system violations) ==="
grep -rn 'style={{' src/ --include="*.jsx" | wc -l

echo ""
echo "=== RAW COLOR VALUES (should be CSS variables) ==="
grep -rn "#[0-9a-fA-F]\{6\}" src/ --include="*.css" | grep -v "var(\|--\|node_modules\|index.css\|:root" | head -30

echo ""
echo "=== NUMBERS NOT IN MONOSPACE (check manually) ==="
# Flag files that render prices/percentages but don't import or use font-mono
grep -rn "price\|percent\|volume\|marketCap\|change" src/pages/ --include="*.jsx" -l

echo ""
echo "=== MISSING DAY MODE STYLES ==="
for cssfile in src/pages/**/*.css src/components/**/*.css; do
  if [ -f "$cssfile" ]; then
    has_day=$(grep -c "day-mode\|app-day-mode" "$cssfile" 2>/dev/null)
    lines=$(wc -l < "$cssfile" 2>/dev/null)
    if [ "$lines" -gt 20 ] && [ "$has_day" -eq 0 ]; then
      echo "NO DAY MODE: $cssfile (${lines} lines)"
    fi
  fi
done

echo ""
echo "=== ACCESSIBILITY GAPS ==="
grep -rn "<img " src/ --include="*.jsx" | grep -v "alt=" | head -10
grep -rn "<button\|<a " src/ --include="*.jsx" | grep -v "aria-\|title=" | wc -l

echo ""
echo "=== EVENT LISTENER LEAKS (missing cleanup) ==="
grep -rn "addEventListener\|setInterval\|setTimeout" src/ --include="*.jsx" | wc -l
grep -rn "removeEventListener\|clearInterval\|clearTimeout" src/ --include="*.jsx" | wc -l

echo ""
echo "=== FETCH WITHOUT ABORT CONTROLLER ==="
grep -rn "fetch(" src/ --include="*.jsx" --include="*.js" -l | wc -l
grep -rn "AbortController\|abort\|signal" src/ --include="*.jsx" --include="*.js" -l | wc -l
```

### 1F: Traders Corner anatomy (the 2172-line monolith)

```bash
echo "=== TRADERS CORNER INTERNAL STRUCTURE ==="
grep -n "^function\|^const.*=.*=>\|^export\|return (" src/pages/TradersCorner/index.jsx | head -80

echo ""
echo "=== IMPORTS ==="
head -100 src/pages/TradersCorner/index.jsx

echo ""
echo "=== STATE DECLARATIONS ==="
grep -n "useState\|useEffect\|useMemo\|useCallback\|useRef\|useContext" src/pages/TradersCorner/index.jsx
```

### 1G: Duplicate utility detection

```bash
echo "=== DUPLICATE FUNCTION NAMES ACROSS FILES ==="
grep -rn "export function\|export const\|export default function" src/ --include="*.jsx" --include="*.js" | \
  sed 's/.*export \(default \)\?\(function\|const\) //' | sed 's/[=(].*//' | sort | uniq -d

echo ""
echo "=== FILES WITH THEIR OWN FORMAT FUNCTIONS (should use shared lib) ==="
grep -rn "const format\|function format" src/pages/ --include="*.jsx" --include="*.js" | grep -v "import"

echo ""
echo "=== MULTIPLE FETCH PATTERNS ==="
grep -rn "fetch(\|axios\." src/ --include="*.jsx" --include="*.js" -l | sort
```

---

### PHASE 1 OUTPUT: Write `CODEBASE_CENSUS.md`

Structure it exactly as follows:

```markdown
# Spectre Codebase Census — [date]
# Prepared for production hardening (100K user target)

## Executive Summary
- Total source files: X
- Total lines of code: X
- Dead files (knip): X
- Dead exports (knip): X
- Unused npm dependencies: X
- Circular dependencies (madge): X
- Orphan files (madge): X
- Files over 500 lines: X
- Files over 300 lines: X
- Pages missing error boundaries: X
- Pages missing day mode: X
- Console.logs in source: X
- Hardcoded colors (not CSS vars): X

## 1. Dead Code (safe to delete)

### Dead Files (entire files, 0 imports anywhere)
| # | File | Lines | Source |
|---|------|-------|--------|
| 1 | path/to/file.jsx | 234 | knip / madge |

### Dead Exports (exported but never used)
| # | Export Name | File | Line |
|---|------------|------|------|

### Unused npm Dependencies
| # | Package | Used anywhere? |
|---|---------|---------------|

## 2. Monoliths (files over 500 lines)
| File | Lines | Extraction Plan |
|------|-------|----------------|

## 3. Circular Dependencies
| Cycle | Files Involved | Risk |
|-------|---------------|------|

## 4. Page Health Report
| Page | Lines | Error Boundary | Loading States | Day Mode | Sub-components | Health |
|------|-------|---------------|----------------|----------|---------------|--------|
(Health: GREEN = production ready, YELLOW = needs work, RED = critical)

## 5. Production Hardening Gaps
### Missing Error Boundaries (pages that will white-screen on crash)
### Silent Failures (empty catch blocks)
### Console.logs (performance + info leak in prod)
### Hardcoded URLs/Keys (security risk)
### Spinners (should be skeleton shimmers per design system)
### Inline Styles (design system violations)
### Raw Colors (should be CSS variables)
### Missing Day Mode
### Event Listener Leaks (memory leaks under sustained use)
### Missing AbortControllers (race conditions on fast navigation)
### Accessibility Gaps

## 6. Duplicate Patterns
| Pattern | Found In | Consolidation Target |
|---------|----------|---------------------|

## 7. Traders Corner Anatomy
| Section | Lines | Function | Can Extract? | Risk |
|---------|-------|----------|-------------|------|

## 8. Surgery Plan (recommended order)
### Wave 1: Zero-risk deletions (dead files, dead exports, unused deps)
### Wave 2: Production hardening (error boundaries, console.log removal, empty catches)
### Wave 3: Page-by-page extraction (monolith splits, starting smallest first)
### Wave 4: Dedup pass (consolidate shared utilities)
### Wave 5: Design system compliance (hardcoded colors, missing day mode, spinners)
### Wave 6: Performance (event listener cleanup, abort controllers, memo optimization)
```

**GATE: Print the Executive Summary to terminal. Wait for my approval before proceeding to any wave.**

---

## PHASE 2: WAVE 1 — Zero-Risk Deletions (dead code only)

Only proceed after I approve the census.

### Rules for this wave:
- Only delete files/exports confirmed dead by BOTH knip AND manual grep verification
- One file per commit
- Build after each deletion
- Commit message: `chore(cleanup): remove dead [file/export] [Name] (confirmed by knip + grep)`

### For each dead file:

```bash
# Triple-check before deleting
FILENAME="ComponentName"
grep -r "$FILENAME" src/ server/ api/ --include="*.jsx" --include="*.js" --include="*.css" -l | grep -v "the-file-itself"
# If truly zero results: delete
git rm path/to/file.jsx path/to/file.css
git commit -m "chore(cleanup): remove dead component $FILENAME"
npm run build
```

### For unused npm dependencies:

```bash
# Verify the dep isn't used
grep -r "package-name" src/ server/ api/ --include="*.jsx" --include="*.js" -l
# Also check for dynamic requires
grep -r "require.*package-name" server/ --include="*.js" -l
# If truly unused:
npm uninstall package-name
git add package.json package-lock.json
git commit -m "chore(cleanup): remove unused dependency package-name"
npm run build
```

If you find more than 20 dead files, do the first 20 and report. I'll approve the next batch.

**GATE: Report total files deleted, total lines removed, build status. Wait for approval.**

---

## PHASE 3: WAVE 2 — Production Hardening

These changes make the app survive 100K users.

### 3A: Create a shared ErrorBoundary component

```bash
# Check if one exists already
grep -r "ErrorBoundary\|componentDidCatch" src/components/ -l
```

If none exists, create `src/components/SectionErrorBoundary.jsx`:
- React class component with `componentDidCatch`
- Renders a minimal fallback: "Something went wrong. Click to retry." with a retry button
- Uses Spectre design tokens (glass card, Inter font, proper opacities)
- Has day mode styles
- Logs the error to console.error (we'll replace with a proper logger later)

Commit: `feat(hardening): add SectionErrorBoundary component`

### 3B: Wrap every page in error boundaries

For each page in `src/pages/*/index.jsx` that lacks an error boundary:
- Import SectionErrorBoundary
- Wrap the page's main return content
- One commit per page
- Build + visual check after each

Commit pattern: `feat(hardening): add error boundary to [PageName]`

### 3C: Remove console.logs from production code

```bash
# Replace console.log with nothing in src/ (keep console.error and console.warn)
# Do NOT touch server/ — those logs are useful for debugging
find src/ -name "*.jsx" -o -name "*.js" | xargs grep -l "console\.log" | while read f; do
  echo "Cleaning: $f"
done
```

For each file: remove or comment out `console.log` statements. Keep `console.error` and `console.warn`.
Do this file by file, one commit per file.

Commit pattern: `chore(hardening): remove console.logs from [filename]`

### 3D: Fix empty catch blocks

For each empty `catch` block found in Phase 1:
- Add at minimum `console.error('Error in [context]:', err)`
- For user-facing operations, add graceful fallback behavior
- One commit per file

Commit pattern: `fix(hardening): add error handling to catch blocks in [filename]`

### 3E: Fix hardcoded localhost URLs

Any `http://localhost` or `127.0.0.1` in src/ should use environment detection:

```javascript
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
```

If this pattern already exists in a service file, make sure all fetch calls use it.
One commit per file.

Commit pattern: `fix(hardening): use dynamic API base in [filename]`

**GATE: Report changes made. Wait for approval.**

---

## PHASE 4: WAVE 3 — Page-by-Page Extraction (monolith splits)

Start with the SMALLEST monolith, not the biggest. Build confidence before tackling the big ones.

### Rules:
- Extract one section at a time into `src/pages/[PageName]/components/[SectionName].jsx`
- The extracted component receives props — no changing how data flows
- The parent file should get SHORTER. If it doesn't, you did it wrong
- Every extraction = one commit = one build = one visual check
- If a page is under 500 lines after dead code removal, skip it

### Extraction pattern:

```jsx
// BEFORE (in index.jsx — 800 lines)
function TradersCornerPage() {
  // ... 50 lines of state
  // ... 200 lines of Section A JSX
  // ... 200 lines of Section B JSX
  // ... 200 lines of Section C JSX
}

// AFTER (in index.jsx — 200 lines)
import SectionA from './components/SectionA';
import SectionB from './components/SectionB';
import SectionC from './components/SectionC';

function TradersCornerPage() {
  // ... 50 lines of state
  return (
    <>
      <SectionA data={data} onAction={handleAction} />
      <SectionB stats={stats} />
      <SectionC config={config} />
    </>
  );
}
```

### For Traders Corner specifically (2172 lines):

First, write `TRADERS_CORNER_SPLIT_PLAN.md` based on the Phase 1 anatomy scan:
- Map every internal function and its line range
- Identify natural section boundaries (each "card" or "panel" is usually one component)
- List what state each section needs
- Propose the extraction order (least coupled first)

**Do NOT start extracting until I approve the split plan.**

Commit pattern: `refactor(TradersCorner): extract [SectionName] to components/`

**GATE: Report split plan. Wait for approval before executing.**

---

## PHASE 5: WAVE 4 — Dedup Pass

### 5A: Consolidate format utilities

If Phase 1 found duplicate `format*` functions across pages:
- Identify the most complete/correct version
- Move it to `src/lib/formatters.js` (or wherever the existing format utils live)
- Update all import paths
- One commit per consolidated function
- Build after each

### 5B: Consolidate fetch patterns

If multiple files have their own fetch wrappers:
- Identify the service layer pattern (should be `src/services/`)
- Consolidate into the appropriate service file
- Update imports
- Build after each

Commit pattern: `refactor(shared): consolidate [pattern] into [target]`

**GATE: Report consolidations. Wait for approval.**

---

## PHASE 6: WAVE 5 — Design System Compliance

### 6A: Replace spinners with skeleton shimmers

For every spinner found in Phase 1:
- Replace with the Spectre skeleton shimmer pattern from SPECTRE_DESIGN_LAW.md
- Use the exact CSS from the design system:
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
background-size: 200% 100%;
animation: shimmer 1.5s ease-in-out infinite;
```
- One commit per file

### 6B: Replace hardcoded colors with CSS variables

For each hardcoded hex color in .css files (not in index.css :root):
- Map to the nearest CSS variable from the design system
- Replace
- Visual check that nothing changes appearance
- One commit per file

### 6C: Replace inline styles with CSS classes

For each `style={{}}` in JSX:
- Move to the component's CSS file using design tokens
- One commit per file

**GATE: Report changes. Wait for approval.**

---

## PHASE 7: WAVE 6 — Performance Hardening

### 7A: Fix event listener leaks

For every `addEventListener` or `setInterval` or `setTimeout` without cleanup:
- Add cleanup in useEffect return function
- One commit per file

### 7B: Add AbortControllers to fetch calls

For data-fetching useEffects that don't abort on unmount:
- Add AbortController pattern
- This prevents race conditions when users navigate fast between pages

```jsx
useEffect(() => {
  const controller = new AbortController();
  fetchData({ signal: controller.signal });
  return () => controller.abort();
}, [deps]);
```

### 7C: Add React.memo to heavy child components

For extracted components that receive stable props and render expensive UI (charts, tables, large lists):
- Wrap in React.memo
- Only where it makes measurable sense — don't memo everything

**GATE: Report changes. Wait for approval.**

---

## PHASE 8: PERMANENT GUARDRAILS — Husky + Lint-Staged

After ALL cleanup is complete and approved:

### 8A: Initialize husky

```bash
npx husky init
```

### 8B: Create pre-commit hook

Create `.husky/pre-commit`:

```bash
#!/bin/sh
npx lint-staged
```

### 8C: Configure lint-staged in package.json

Add to `package.json`:

```json
{
  "lint-staged": {
    "src/**/*.{js,jsx}": [
      "node -e \"const fs=require('fs'); const f=process.argv[1]; const c=fs.readFileSync(f,'utf8'); if(/console\\.log/.test(c)){console.error('console.log found in '+f); process.exit(1)}\"",
      "node -e \"const fs=require('fs'); const c=fs.readFileSync(process.argv[1],'utf8'); if(/style=\\{\\{/.test(c) && !/style=\\{\\{.*\\}\\}/.test('WHITELIST')){console.warn('Inline style detected in '+process.argv[1])}\""
    ],
    "src/**/*.css": [
      "node -e \"const fs=require('fs'); const c=fs.readFileSync(process.argv[1],'utf8'); const matches=c.match(/#[0-9a-fA-F]{6}/g); if(matches){const inRoot=c.includes(':root'); if(!inRoot && matches.length>0){console.warn('Hardcoded colors in '+process.argv[1]+': '+matches.join(', '))}}\""
    ]
  }
}
```

### 8D: Create REVIEW.md for future Code Review integration

Create `REVIEW.md` in project root:

```markdown
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
```

### 8E: Commit guardrails

```bash
git add .husky/ package.json REVIEW.md
git commit -m "chore: add husky pre-commit hooks and REVIEW.md guardrails"
npm run build
```

**GATE: Report that guardrails are active. Session complete.**

---

## FINAL OUTPUT

When all phases are complete, update `CODEBASE_CENSUS.md` with a closing section:

```markdown
## Surgery Results

### Before
- Total files: X
- Total lines: X
- Dead files: X
- Console.logs: X
- Pages without error boundaries: X

### After
- Total files: X
- Total lines: X (delta: -X)
- Dead files: 0
- Console.logs in src/: 0
- Pages without error boundaries: 0
- Circular dependencies: X (list if any remain)

### Guardrails Installed
- [x] knip (dead code detection)
- [x] madge (dependency analysis)
- [x] husky pre-commit (console.log block, inline style warning, hardcoded color warning)
- [x] REVIEW.md (ready for Claude Code Review when available)
- [x] SectionErrorBoundary on all pages

### Remaining Tech Debt (for future sessions)
- TradingChart.jsx: 4390 lines (waiting for Lightweight Charts v5 overhaul)
- [any other items deferred]
```

Print the Surgery Results summary to terminal when done.
