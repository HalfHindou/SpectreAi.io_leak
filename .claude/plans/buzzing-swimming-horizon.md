# Adopt gstack Patterns for Spectre AI

## Context

Garry Tan's gstack (github.com/garrytan/gstack) provides 8 Claude Code slash commands that transform Claude into specialized engineering roles. We want to cherry-pick the patterns that add real value for a 2-person crypto platform team, not adopt everything.

**What we're adopting (5 items):**
1. 2-pass review checklist (blocking vs informational) - highest value
2. `/plan` command with Founder + Engineering modes
3. `/ship` command for automated PR creation
4. Structured TODOS.md format
5. Enhanced `/notes` routing to TODOS.md

**What we're skipping:**
- `/browse` - we already use Claude Preview MCP tools
- `/setup-browser-cookies` - not needed
- `/retro` - overkill for 2-person team
- `/qa` with health scoring - `/verify` already covers our needs
- Greptile integration - not used
- Bun tooling - we use Node.js

---

## Deliverables

### 1. CREATE `.claude/review/checklist.md`
Foundational file consumed by both `/review` and `/ship`.

**Pass 1 - CRITICAL (blocks shipping):**
- **API Key & Secret Safety** - env var leaks in diffs, `VITE_` prefix misuse, keys in client code
- **Race Conditions & Stale State** - React stale closures, missing AbortController cleanup, Zustand selector instability, concurrent API mutations
- **Data Safety** - dangerouslySetInnerHTML, user input in URLs/query params, missing error boundaries around async UI
- **Production Routing Gap** - new Express routes missing Vercel serverless counterparts (biggest recurring issue in this codebase)

**Pass 2 - INFORMATIONAL (note but don't block):**
- **Convention Compliance** - TypeScript in app code, missing CSS pairing, hardcoded colors/spacing, missing day mode, sans-serif numbers, `@/` alias misuse
- **Dead Code** - unused exports, orphan CSS classes, imports of known dead modules
- **Performance** - inline object/function allocations in JSX, missing memoization, un-debounced API calls
- **Cross-App Architecture** - inter-app imports, duplicated code that belongs in packages/, token registry gaps
- **Console & Debug Artifacts** - console.log in prod paths, hardcoded localhost, TODO/FIXME left in
- **Crypto-Specific** - Binance fallback chain correctness, CoinGecko rate limit handling, token resolution edge cases

### 2. MODIFY `.claude/commands/review.md`
Restructure existing review to use the checklist.

Current: freeform dimensional review (works but unstructured).
New:
- Step 1: Load `.claude/review/checklist.md`
- Step 2: `git diff HEAD --stat`, read changed files
- Step 3: Run relevant build(s)
- Step 4: **Pass 1** - Critical checks. Each finding: `[file:line]` + problem + fix. Ask per critical finding: Fix now / Acknowledge / Skip
- Step 5: **Pass 2** - Informational checks. Same format, listed but non-blocking.
- Step 6: Structured summary (BLOCK count, WARN count, PASS/FAIL)

### 3. CREATE `.claude/commands/plan.md`
Single command with mode selection. Argument: `[feature or task to plan]`.

**Step 0 - Pre-Review:**
- `git log --oneline -10` for in-flight work
- Check `TODOS.md` for related items
- Grep affected files for FIXME/TODO

**Step 1 - Scope Challenge (always):**
- Is this the right problem now?
- What already exists? (Grep/Glob to find)
- Ask: **Founder mode** (product thinking) or **Engineering mode** (implementation rigor)?

**Founder mode** (from gstack's plan-ceo-review):
- Choose posture: EXPANSION / HOLD SCOPE / REDUCTION
- 6 sections: Architecture (ASCII diagram mandatory), Error Map, Security, Edge Cases, Performance, Deferred Work (to TODOS.md)
- One issue = one question, 2-3 options, recommendation first

**Engineering mode** (from gstack's plan-eng-review):
- 4 sections: Architecture + file changes + agent routing, Code Quality, Verification Strategy, Performance
- Diagrams mandatory for data flow
- Output: ordered implementation steps, NOT-in-scope list

### 4. CREATE `.claude/commands/ship.md`
Automated PR creation workflow.

Steps:
1. Pre-flight: verify not on main, `git status`, `git diff --stat`
2. Stage + commit uncommitted changes (auto-generate message)
3. `git fetch origin main && git merge origin/main` (stop on conflicts)
4. Build verification: detect changed apps from diff, run relevant builds (stop on failure)
5. Critical review: load checklist, run Pass 1 only (stop on critical findings)
6. `git push -u origin <branch>`
7. Generate PR body (summary from commits, file changes, Pass 2 findings)
8. `gh pr create --base main --head <branch>` with structured body
9. Output PR URL

**PR body template:**
```
## Summary
[auto from commits]

## Changes
[file-level summary]

## Review Notes
[Pass 2 informational, if any]

## Build
- research: PASS/SKIP
- trading: PASS/SKIP
```

### 5. CREATE `TODOS.md` (monorepo root)
Structured work backlog with format from gstack's TODOS-format.md.

Sections: Research App, Trading App, Server/Infra, Shared/Design System, Completed.

Item format:
```
### [title]
- **What:** one line
- **Why:** problem or value
- **Owner:** Sunny / Gleb / Either
- **Effort:** S / M / L
- **Priority:** P0-P3
```

Seed with 3-5 known items (Express/Vercel route parity, dead code cleanup, etc.)

### 6. MODIFY `.claude/commands/notes.md`
Add one row to the routing table:
```
| New work item discovered | `TODOS.md` |
```

### 7. MODIFY `CLAUDE.md`
Add to Custom Commands section:
```
- `/plan [task]` - founder or engineering mode planning with structured scope challenge
- `/ship` - automated PR creation with pre-flight checks, build verification, and review
```

Add to Self-Improvement section:
```
After review corrections, also update `.claude/review/checklist.md` if the finding represents a recurring pattern.
```

---

## Implementation Order

```
Parallel group 1:  checklist.md  +  TODOS.md
Parallel group 2:  plan.md  +  ship.md  (depend on group 1)
Sequential:        review.md  ->  notes.md  ->  CLAUDE.md
```

## Files to Create/Modify

| File | Action | Size |
|------|--------|------|
| `.claude/review/checklist.md` | CREATE | ~80 lines |
| `.claude/commands/plan.md` | CREATE | ~90 lines |
| `.claude/commands/ship.md` | CREATE | ~70 lines |
| `TODOS.md` | CREATE | ~40 lines |
| `.claude/commands/review.md` | MODIFY | rewrite ~60 lines |
| `.claude/commands/notes.md` | MODIFY | add 1 row |
| `CLAUDE.md` | MODIFY | add 3 lines |

## Verification

1. Run `/review` on current uncommitted changes - should load checklist, run 2-pass
2. Run `/plan add WebSocket support` - should ask Founder/Engineering mode
3. Run `/ship` - should detect branch, build, create PR
4. Check TODOS.md exists and has correct format
5. Run `/notes` - should include TODOS.md as a routing destination
