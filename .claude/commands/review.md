---
description: Review current changes as a demanding staff engineer - 2-pass checklist with critical blocking and informational findings
allowed-tools: Agent, Bash, Glob, Grep, Read, TodoWrite, AskUserQuestion
---

Review the current uncommitted changes using the structured 2-pass checklist. Critical findings block shipping; informational findings are noted.

## Step 1: Gather Context

1. `git diff HEAD --stat` to see what changed
2. Read all changed files
3. Load `.claude/review/checklist.md`

## Step 2: Build Verification

Detect which apps changed from the diff:
- Files in `apps/research/` -> `npm run build:research`
- Files in `apps/trading/` -> `npm run build:trading`
- Files in `packages/` -> build both apps
- Files only in `.claude/`, `TODOS.md`, docs -> skip build

Run the relevant build(s). Record PASS or FAIL.

## Step 3: Pass 1 - Critical (blocks shipping)

Run every check in `.claude/review/checklist.md` Pass 1 against the diff. Skip categories with zero findings.

For each finding:
- Cite as `[file:line]` with one-line problem + suggested fix
- Present interactively: **Fix** / **Acknowledge** / **Skip**
  - Fix: make the fix, re-run build if needed
  - Acknowledge: note as known issue in output
  - Skip: omit from output

## Step 4: Pass 2 - Informational (note but don't block)

Run every check in `.claude/review/checklist.md` Pass 2 against the diff. Skip categories with zero findings.

For each finding:
- Cite as `[file:line]` with one-line problem + suggested fix
- No interactive prompt - just list them

## Step 5: Output

```
## Pre-Landing Review

### Pass 1 - Critical
[findings or "No critical issues found"]

### Pass 2 - Informational
[findings or "No informational issues"]

### Summary
- Critical: N issues (N fixed, N acknowledged, N skipped)
- Informational: N issues
- Build: PASS/FAIL
- Verdict: SHIP / DO NOT SHIP
```

If the code is genuinely good, say so briefly. Do not manufacture issues.

## Step 6: Learning Capture

- For each CRITICAL finding that was fixed: append to `.claude/learning/corrections.md` with date, domain, severity, description, root cause
- For novel finding types not in `.claude/review/checklist.md`: add them to the checklist
- Update agent memory if the finding reveals a file-level gotcha
