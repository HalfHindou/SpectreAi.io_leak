# Parallel AI Orchestration Guide

> **Goal:** Decompose features into independent sub-problems, assign each to a separate Cursor Composer session, and merge the results. This turns multi-day serial work into hours.

---

## Quick Start Checklist

1. [ ] Define the feature scope and success criteria
2. [ ] Create shared interfaces in `packages/shared/` FIRST
3. [ ] Decompose into 4-8 independent streams (use template below)
4. [ ] Write a self-contained prompt for each stream
5. [ ] Assign file ownership — no two streams touch the same file
6. [ ] Launch all streams (multiple Composer sessions or Task agents)
7. [ ] Monitor progress, resolve conflicts
8. [ ] Merge in order: types > database > backend > frontend > tests > docs

---

## Decomposition Rules

### Rule 1: File Ownership

Every stream MUST own exclusive files. No two streams edit the same file.

**Good:**
- Stream A owns `server/ws/` (all files in this directory)
- Stream B owns `server/cache/` (all files in this directory)

**Bad:**
- Stream A and B both edit `server/index.js`

### Rule 2: Shared Contracts First

Before launching any stream, create the shared interfaces that all streams reference.
These live in `packages/shared/src/` and define:

- TypeScript types for all data structures
- Event names and payloads
- API request/response shapes
- Constants and configuration values

### Rule 3: Independent Testability

Each stream must produce output that can be verified independently:
- A service with unit tests
- An API endpoint that returns expected JSON
- A UI component that renders correctly in isolation

### Rule 4: Clear Merge Order

Some streams can merge in any order (database, cache, docs).
Others have a natural dependency order for integration:

```
1. Shared Types (already done before streams launch)
2. Database Schema + Migrations (no deps)
3. Cache Layer (no deps)
4. Backend Services + API Routes (reads DB schema)
5. WebSocket Server (reads types)
6. Frontend Components + Hooks (reads API contract)
7. Error Handling + Logging (reads all layers)
8. Tests (reads everything, uses mocks)
9. Documentation (reads everything)
```

---

## Execution Methods

### Method 1: Multi-Composer (Best for 4-8 streams)

Open multiple Cursor Composer windows, each running an independent stream.

**Setup:**
1. Open Composer Session 1 → paste Stream 1 prompt
2. Open Composer Session 2 → paste Stream 2 prompt
3. ... repeat for each stream
4. Let all sessions run simultaneously

**Merge:**
- Each session creates files in its own directory
- Use `git status` to see all changes
- Resolve any integration points manually or with a final "merge" Composer session

### Method 2: Task Sub-Agents (Best for 2-4 streams)

Use a single Composer session that launches parallel Task agents.

**Setup:**
In a single message, launch multiple Task tool calls:
- Task 1: "Create WebSocket server in server/ws/"
- Task 2: "Create Redis cache layer in server/cache/"
- Task 3: "Create frontend WS hook in src/hooks/"

**Limits:** Maximum 4 concurrent Task agents per Composer session.

### Method 3: Hybrid (Maximum parallelism)

Combine both methods:
- 2-3 Composer sessions
- Each launches 2-4 Task agents
- Theoretical max: ~12 concurrent AI streams

---

## Stream Prompt Template

Each stream prompt must be **self-contained** — the AI session has no prior context.

```markdown
# Stream: [Stream Name]

## Context
You are working on the Spectre AI Trading Terminal, a non-custodial crypto
trading platform. The project uses:
- Frontend: React 18 + Vite + Tailwind-style CSS
- Backend: Express.js (Node.js)
- Real-time: WebSockets (planned)
- Database: PostgreSQL (planned)
- Cache: Redis (planned)

## Your Task
[Detailed description of what to build]

## Files You Own (create/edit ONLY these)
- `path/to/file1.ts`
- `path/to/file2.ts`
- `path/to/directory/`

## DO NOT Touch
- Any file outside your owned paths
- `server/index.js` (main server — owned by integration stream)
- `src/App.jsx` (main app — owned by integration stream)

## Shared Interfaces
Reference types from `packages/shared/src/types/` for all data structures.
[Include relevant type definitions inline so the agent has them]

## Success Criteria
- [ ] [Specific, verifiable criterion 1]
- [ ] [Specific, verifiable criterion 2]
- [ ] [Specific, verifiable criterion 3]

## Patterns to Follow
[Include code snippets showing the project's existing patterns]
```

---

## Feature Decomposition Template

Save decomposition plans to `.claude/plans/<feature-name>.md`:

```markdown
# Feature: [Name]
# Estimated Serial Time: [X days]
# Estimated Parallel Time: [Y hours]
# Streams: [N]

## Pre-Launch: Shared Interfaces
Create these files BEFORE launching any stream:
- `packages/shared/src/types/[feature].ts` — all shared types
- `packages/shared/src/constants/[feature].ts` — shared constants
- `packages/shared/src/events/[feature].ts` — event definitions

## Stream 1: [Name]
- **Owner:** Composer Session 1
- **Files:** [list]
- **Deliverable:** [what "done" looks like]
- **Dependencies:** None
- **Prompt:** [full self-contained prompt — see template above]

## Stream 2: [Name]
...

## Post-Merge: Integration
After all streams complete:
1. Wire up imports in main server file
2. Wire up imports in main App component
3. Run full test suite
4. Update README/documentation
```

---

## Common Parallel Patterns for Trading Features

### Pattern A: Full-Stack Feature (8 streams)

| # | Stream | Scope | Typical Files |
|---|--------|-------|---------------|
| 1 | Database | Schema, migrations, models | `server/db/`, `server/models/` |
| 2 | Cache | Redis service, TTL config | `server/cache/` |
| 3 | Backend Service | Business logic | `server/services/` |
| 4 | API Routes | REST endpoints | `server/routes/` |
| 5 | WebSocket | Real-time handlers | `server/ws/` |
| 6 | Frontend | Components, hooks, stores | `src/components/`, `src/hooks/` |
| 7 | Tests | Unit + integration | `tests/` |
| 8 | Documentation | API docs, guides | `docs/` |

### Pattern B: Backend-Heavy Feature (5 streams)

| # | Stream | Scope |
|---|--------|-------|
| 1 | Database + Models | Schema and data access |
| 2 | Service Layer | Business logic |
| 3 | API + WebSocket | HTTP and WS endpoints |
| 4 | Tests | All backend tests |
| 5 | Documentation | API docs |

### Pattern C: Frontend-Heavy Feature (5 streams)

| # | Stream | Scope |
|---|--------|-------|
| 1 | State Management | Zustand stores, data hooks |
| 2 | Core Components | Main UI components |
| 3 | Supporting Components | Modals, tooltips, forms |
| 4 | Styling | CSS, animations |
| 5 | Tests + Storybook | Component tests and stories |

---

## Conflict Resolution

### If Two Streams Need the Same File

1. **Prefer splitting the file** — extract into two files, each owned by one stream
2. **If splitting is impossible** — one stream owns it, the other provides a patch/diff in its output
3. **Last resort** — run a "merge" Composer session after both streams finish

### If a Stream Depends on Another's Output

1. **Mock the dependency** — stream uses mock data matching the shared interface
2. **Define the contract** — put the interface in `packages/shared/`
3. **Integration happens post-merge** — a final session wires real implementations

---

## Monitoring Progress

When running multiple Composer sessions:

1. Check each session periodically for errors or blocks
2. If a session is stuck, provide additional context
3. Keep a checklist of stream completion:

```
[x] Stream 1: Database — DONE
[x] Stream 2: Cache — DONE
[ ] Stream 3: Backend — IN PROGRESS (85%)
[ ] Stream 4: WebSocket — IN PROGRESS (60%)
[x] Stream 5: Frontend — DONE
[ ] Stream 6: Tests — WAITING (needs backend)
[x] Stream 7: Error Handling — DONE
[x] Stream 8: Documentation — DONE
```

---

## Post-Merge Integration Checklist

After all streams complete:

- [ ] All streams' files are present and non-conflicting
- [ ] Shared types are imported correctly everywhere
- [ ] Main server file (`server/index.js`) wires up new routes/WS/middleware
- [ ] Main app file (`src/App.jsx`) imports new components
- [ ] Environment variables documented in `.env.example`
- [ ] `package.json` has all new dependencies
- [ ] Tests pass: `npm test` / `bun test`
- [ ] Dev server starts: `npm run dev:all`
- [ ] No TypeScript/lint errors
- [ ] README updated with new features
