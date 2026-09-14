---
description: Capture session learnings - what worked, what broke, what to remember for next time
---

Capture what was learned in this session. Update project memory so future sessions start smarter.

## Step 1: Reflect on This Session

Review the conversation and identify:
1. **Corrections received** - anything the user corrected that indicates a missing rule
2. **Gotchas discovered** - environment quirks, API behaviors, CSS specificity surprises
3. **Patterns established** - new patterns used for the first time that should be standard
4. **Dead ends** - approaches tried that failed and why
5. **File discoveries** - important files or code locations not previously documented

## Step 2: Route Each Learning

| Category | Destination |
|----------|-------------|
| Coding rule | `.claude/rules/coding-standards.md` |
| Design rule | `.claude/rules/design-system.md` |
| Workflow rule | `.claude/rules/workflow.md` |
| Dev setup | `.claude/rules/dev-workflow.md` |
| Project knowledge | `MEMORY.md` (auto-memory) |
| New work item discovered | `TODOS.md` |
| User correction | `.claude/learning/corrections.md` (append structured entry) |
| Successful pattern | `.claude/learning/patterns.md` (append with file refs) |
| User preference | auto-memory `user_gleb.md` |
| Agent-specific | `.claude/agent-memory/*/MEMORY.md` |

## Step 3: Draft and Apply Updates

For each learning, write the specific line(s) to add. Show the user all proposed updates grouped by file:

```
### [filename]
+ New line to add

Reason: [why this matters for future sessions]
```

## Step 4: Promote and Prune

1. Scan `corrections.md` for entries with same `[DOMAIN]` appearing 3+ times without `rule created? yes`
   - If found: draft a rule, add to appropriate `.claude/rules/*.md`, mark entries as promoted
2. Remove entries from `corrections.md` that have `rule created? yes` and are older than 14 days
3. If `corrections.md` exceeds 30 entries, remove oldest promoted entries first
4. If any new files were created/deleted/moved during the session, note in MEMORY.md for spectre-graph update

## Guidelines
- One line per concept. Rules files are part of the prompt budget.
- Only add things that will recur. One-off debugging steps are not worth documenting.
- If a rule already exists but was missed, make it more prominent rather than duplicating.
- Check existing rules before adding - avoid contradictions.
