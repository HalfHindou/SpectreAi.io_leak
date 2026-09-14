---
description: Automated PR creation with pre-flight checks, build verification, and review
allowed-tools: Bash, Glob, Grep, Read, Write, Edit, TodoWrite
---

Ship the current branch: stage, build, review, push, and create a PR. Stops only for merge conflicts, build failures, and critical review findings.

## Step 1 - Pre-flight

1. Verify not on `main`: `git rev-parse --abbrev-ref HEAD`
   - If on main, STOP: "Cannot ship from main. Create a feature branch first."
2. `git status` to check for uncommitted changes
3. `git diff HEAD --stat` to see scope of changes
4. `git log origin/main..HEAD --oneline` to see commits on this branch

## Step 2 - Stage & Commit

If there are uncommitted changes:
1. Stage relevant files (avoid .env, credentials, large binaries)
2. Auto-generate a commit message from the diff:
   - Summarize the nature (feat/fix/refactor/chore)
   - One-line summary + optional body
   - End with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
3. Commit

If no uncommitted changes, skip to Step 3.

## Step 3 - Merge Latest Main

```bash
git fetch origin main && git merge origin/main
```

- If merge succeeds cleanly: continue
- If merge conflicts: STOP. List conflicting files. Ask user how to resolve.

## Step 4 - Build Verification

Detect which apps changed from the diff:
- Files in `apps/research/` -> `npm run build:research`
- Files in `apps/trading/` -> `npm run build:trading`
- Files in `packages/` -> build both apps
- Files only in `.claude/`, `TODOS.md`, docs -> skip build

Run the relevant build(s).
- If build passes: continue
- If build fails: STOP. Show error. Ask user to fix.

## Step 5 - Critical Review (Pass 1 only)

Load `.claude/review/checklist.md` and run Pass 1 (Critical) checks against the full branch diff (`git diff origin/main...HEAD`).

- If no critical findings: continue
- If critical findings: present each one with Fix / Acknowledge / Skip options
  - Fix: make the fix, re-run build
  - Acknowledge: note in PR body as known issue
  - Skip: omit from PR body

## Step 6 - Push

```bash
git push -u origin HEAD
```

If push fails (e.g., no upstream): `git push --set-upstream origin $(git rev-parse --abbrev-ref HEAD)`

## Step 7 - Generate PR Body

Run Pass 2 (Informational) checks from the checklist. Then generate:

```markdown
## Summary
[1-3 bullet points from commit messages on this branch]

## Changes
[file-level summary grouped by domain: research app, trading app, server, shared]

## Review Notes
[Pass 2 informational findings, if any. "None" if clean.]

## Build
- research: PASS / SKIP (not changed)
- trading: PASS / SKIP (not changed)
```

## Step 8 - Create PR

```bash
gh pr create --base main --head <branch> --title "<title>" --body "<body>"
```

Title: short (under 70 chars), derived from commits.
Body: from Step 7 template.

## Step 9 - Report

Output:
- PR URL
- Summary of what shipped
- Any acknowledged issues from Step 5
- TODOS.md updates (if deferred work was noted)

---

## Stopping Points (summary)

| Condition | Action |
|-----------|--------|
| On main branch | STOP - ask user to create branch |
| Merge conflicts | STOP - list files, ask resolution |
| Build failure | STOP - show error, ask for fix |
| Critical review finding | STOP per finding - Fix/Acknowledge/Skip |
| Push failure | Retry with --set-upstream |

## Step 10 - Post-Ship Learning

1. If new files/components were created, append proven patterns to `.claude/learning/patterns.md`
2. If new pages, API routes, or components aren't in spectre-graph, add to TODOS.md: "Update spectre-graph: [what changed]"
3. Update `TODOS.md` - mark shipped items as completed with date

## Never Stops For

- Uncommitted changes (auto-commits)
- Clean merges
- Informational review findings (included in PR body)
- Chunk size warnings from Vite
