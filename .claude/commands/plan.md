---
description: Founder or engineering mode planning with structured scope challenge
allowed-tools: Agent, Bash, Glob, Grep, Read, TodoWrite, AskUserQuestion
---

Plan a feature, task, or architectural change with structured rigor. Choose between Founder mode (product thinking) and Engineering mode (implementation detail).

Argument: $ARGUMENTS (the feature or task to plan)

## Step 0 - Pre-Review Audit

Before any planning, gather context:

1. Run `git log --oneline -10` to see what is in flight
2. Read `TODOS.md` for related backlog items
3. Grep affected areas for FIXME/TODO comments
4. Use Glob/Grep to find what already exists related to this task

## Step 1 - Scope Challenge

Before diving into details, challenge the scope:

1. **Is this the right problem to solve right now?** Consider what else is in flight.
2. **What already exists?** Search the codebase - reuse over rebuild.
3. **Where does this leave us in 6 months?** Quick win or strategic investment?

Then ask the user:

> **Which planning mode?**
> - **A) Founder mode** - Product thinking. Dream big, challenge assumptions, find the 10x version. Best for new features, pivots, and "should we even build this?" questions.
> - **B) Engineering mode** - Implementation rigor. Architecture, file changes, verification strategy. Best for well-scoped tasks ready for execution.

Wait for their answer before proceeding.

---

## Founder Mode

After user selects Founder mode, ask for posture:

> **What posture for this plan?**
> - **EXPANSION** - Dream big. "What would make this 10x better for 2x effort?" Use for greenfield features.
> - **HOLD SCOPE** - Maximum rigor on stated scope. Bulletproof execution. Use for bug fixes, refactors, well-defined features.
> - **REDUCTION** - Strip to essentials. Minimum viable version. Use when complexity concerns arise.

Once posture is chosen, commit to it fully. Work through these 6 sections sequentially:

### F1. Architecture
- Draw an ASCII diagram of the system with the proposed change
- Map dependencies: what calls what, what breaks if this fails
- Identify 4 data flow paths (happy path, error, edge case, concurrent)

### F2. Error Map
- Name every failure mode the change introduces
- For each: what the user sees, what recovers it, what logs it
- Present as a table: Failure | User Impact | Recovery | Observability

### F3. Security
- Attack surface: what new inputs does this accept?
- Auth boundaries: does this respect existing auth gates?
- Secrets: any new env vars, keys, or tokens needed?

### F4. Edge Cases
- Empty states, null data, network failures
- Double-click, stale state, race conditions
- Mobile vs desktop behavior differences
- What happens if the API returns unexpected data?

### F5. Performance
- Re-render analysis for React components
- API call volume: how many requests per user action?
- Caching strategy: what to cache, TTL, invalidation

### F6. Deferred Work
- Explicit NOT-in-scope list (what we are choosing to skip)
- Add deferred items to TODOS.md with proper format
- Flag anything that is tech debt being created intentionally

**For each section:** If you find an issue requiring a decision, present it as a single question with 2-3 options (A, B, C). Lead with your recommendation and explain why. One issue = one question. Never batch multiple decisions.

**Final output:** Ordered implementation steps, NOT-in-scope list, TODOS.md updates.

---

## Engineering Mode

Work through these 4 sections sequentially:

### E1. Architecture
- ASCII diagram of file changes and their relationships
- Route task to agents using spectre-work routing table (FrontyR, FrontyT, Backy, etc.)
- Map which files are created, modified, or deleted
- Identify integration points between agents/domains

### E2. Code Quality
- Check for DRY violations: does this duplicate existing code?
- Verify convention compliance against `.claude/rules/coding-standards.md`
- Error handling: meaningful catches, not empty blocks
- Diagram accuracy: update any existing ASCII diagrams in affected files

### E3. Verification Strategy
- Which builds to run (`npm run build:research`, `npm run build:trading`, or both)
- What to check via `preview_snapshot` / `preview_inspect` / `preview_eval`
- What to `curl` for API changes
- What console errors to watch for

### E4. Performance
- Specific to the planned changes: re-renders, API calls, bundle impact
- Identify if memoization, debouncing, or caching is needed

**For each section:** Same question pattern as Founder mode - one issue, 2-3 options, recommendation first.

**Final output:** Ordered implementation steps with file paths, NOT-in-scope list, verification checklist.
