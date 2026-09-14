---
description: Verify current changes work - run builds, check runtime, diff behavior before and after
---

Prove that the current changes work correctly. Do not trust that code compiles - verify behavior.

## Step 1: Build Check
Run all relevant builds based on which files changed:
- Changes in `apps/research/` -> `npm run build:research`
- Changes in `apps/trading/` -> `npm run build:trading`
- Changes in `packages/spectre-ui/` -> `npm run build:ui`
- Changes in `packages/server/` -> verify server starts without errors

Report: PASS or FAIL with error details.

## Step 2: Runtime Check (if dev server running)
- `preview_snapshot` - verify the page renders, check for error text
- `preview_console_logs` with `level: 'error'` - check for runtime errors
- `preview_network` with `filter: 'failed'` - check for failed API calls
- For visual changes, use `preview_inspect` on affected elements to verify CSS

Report: list of runtime issues found, or "clean."

## Step 3: Behavioral Diff
For each changed file, describe:
1. What the old behavior was (from git diff context)
2. What the new behavior should be
3. How you verified the new behavior works

## Step 4: Regression Check
- Did the change break any existing functionality visible in the snapshot?
- Are there console errors that did not exist before?
- Do network requests that worked before now fail?

## Output

```
## Verification Report

### Build
- research: PASS/FAIL
- trading: PASS/FAIL

### Runtime
- Console errors: none / [list]
- Network failures: none / [list]

### Behavior
- [change 1]: Verified - [how]

### Regressions
- None found / [list]

### Verdict: SHIP IT / NEEDS WORK
```
