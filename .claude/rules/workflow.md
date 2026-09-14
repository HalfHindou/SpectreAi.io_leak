# Workflow Rules

## Plan Mode
- Start every multi-file or architectural task in plan mode. Outline the approach before writing code.
- When implementation goes sideways (3+ failed attempts, wrong direction, cascading breakage), stop coding and switch back to plan mode. Re-evaluate the approach before continuing.
- Use plan mode for verification steps too: before marking a feature done, plan what needs checking (build, visual, behavioral).
- For single-file, well-scoped changes (CSS tweak, copy change, bug fix with obvious root cause), skip plan mode and implement directly.

## Verification
- Always prove changes work before reporting completion. At minimum:
  1. Run the relevant build: `npm run build:research` or `npm run build:trading`
  2. If a dev server is running, use `preview_snapshot` or `preview_inspect` to verify the UI
  3. For API changes, `curl` the endpoint or check `preview_network`
- If a fix feels mediocre (band-aid, excessive complexity, special-casing), scrap it and implement the elegant solution. Do not ship the first thing that works.
- After every change, run `preview_console_logs` with `level: 'error'` to catch silent runtime errors.

## Bug Fixing
- When the user pastes an error, fix it immediately. No preamble, no explanation of what the error means. Just fix it.
- When told "fix the failing build," run the build, read the error, fix it, run the build again. Repeat until clean.
- For production issues, check server logs first (`preview_logs` or Vercel deployment logs). Do not guess at the cause.
- For Codex-cost/usage questions, read our own counter first: `codex:m:<YYYY-MM-DD>` hash in Upstash (creds in `.env`; written by `packages/server/lib/codex-metrics-kv.js`, per-op + per-source). It answers "is it us?" in 30 seconds; request-path probes cannot rule out async/worker-side spend.
- For intermittent bugs, add a `console.error` with context to make the next occurrence debuggable, then fix the root cause.

## Proactive Skill & Memory Usage
- Run skills proactively when the context matches - do not wait for the user to invoke them.
- `spectre-graph` - use for codebase knowledge queries and navigation when exploring unfamiliar areas.
- `spectre-work` - use for multi-domain tasks that touch 3+ files across different apps/packages.
- `/review` - run automatically after completing code changes (not just when asked).
- `/notes` - offer after significant debugging or feature sessions.
- Update `MEMORY.md`, `TODOS.md`, plans, and `.claude/rules/` files automatically after every significant change or learning. Never wait to be asked.

### Automatic Learning Triggers

| Event | Action | File |
|-------|--------|------|
| User says "no", "wrong", "not like that" | Append correction entry | `.claude/learning/corrections.md` |
| User approves result ("perfect", "ship it") | Append pattern | `.claude/learning/patterns.md` |
| User uses unfamiliar shorthand | Add to Proven Phrases | auto-memory `user_gleb.md` |
| User expresses frustration | Add to Pet Peeves | auto-memory `user_gleb.md` |
| Agent discovers file-level gotcha | Update agent memory | `.claude/agent-memory/*/MEMORY.md` |
| Build fails | Record root cause | `.claude/learning/corrections.md` |
| New component/page created | Check if spectre-graph needs update | `TODOS.md` |
| Feature completed | Mark done | `TODOS.md` |
| `/notes` runs | Promote recurring corrections to rules, prune | all learning files |

## Self-Improvement
- After every correction from the user, determine if the mistake was caused by a missing or unclear rule:
  - If yes: update the relevant `.claude/rules/*.md` file so it does not happen again
  - If the correction is project-specific knowledge: update `MEMORY.md` (via auto-memory)
  - If the correction is agent-specific: update the relevant `.claude/agent-memory/*/MEMORY.md`
- Do not wait for the user to ask for rule updates. Do it automatically and mention it briefly.
- After completing a significant feature or debugging session, offer to run `/notes` to capture learnings.

## Review Agent Rules
- Review agents MUST check the **full render tree** — not just individual components in isolation. When a page has `{isMobile && ...}` and `{!isMobile && ...}` branches, verify that EVERY major section is properly guarded. CSS-only hiding is NOT sufficient.
- After any mobile layout change, explicitly verify: "Is every desktop-only section wrapped in `{!isMobile && ...}`? Is every mobile-only section wrapped in `{isMobile && ...}`?"
- When reviewing CSS day-mode migrations, check that comma-grouped selectors correctly target **children** (`.parent .child`), not the parent root. A common bug: `.app.app-day-mode .parent,` followed by `.parent.parent--day .child` — the first selector matches the parent, not the child.
- **Layout cascade chain audit (MANDATORY for mobile)**: Trace padding from viewport → `app-main-content` → page wrapper → content container. Check for competing `!important` rules across CSS files. Shorthand `padding: 8px` resets all sides including top — verify it doesn't override a child's `padding-top: 52px`. This bug was missed 3 times by review agents.
- **Cross-file `!important` conflict detection (MANDATORY)**: When reviewing mobile CSS, grep ALL CSS files for the same selector (e.g., `.welcome-page`) with `!important` on the same property. Multiple files setting the same property with `!important` at equal specificity means the winner depends on CSS load order, which can differ between dev and prod builds. The fix: consolidate to ONE file, remove from all others. Key files to cross-check: `mobile-2026.css` (global), `*-responsive.css` (legacy), `*.mobile.css` (new mobile).

## Subagent Usage
- For any task that touches 3+ files across different domains, use `/spectre-work` orchestrator or spawn subagents directly.
- For compute-heavy operations (full-codebase search, large refactors, comprehensive reviews), always use subagents to keep the main session's context window clean.
- After subagents complete, run Audy (code reviewer) for quality assurance on non-trivial changes.

## Spec Clarity
- If a user request is ambiguous about scope, behavior, or visual outcome, ask a single clarifying question before starting. Do not guess on high-impact decisions.
- If the user says "whatever you think is best," state your decision explicitly so they can course-correct before you build.

## Automatic Behaviors (always-on)
- Explain WHY behind every non-trivial change. For bugs, explain root cause.
- ASCII diagrams when task involves architecture/data flow across 2+ files (under 80 chars wide).
- HTML presentations at `/tmp/explain-[topic].html` (Spectre dark theme) when explanation spans 4+ files.
- Orient on new domains - brief key files/patterns/gotchas when touching unfamiliar code.
- Track knowledge in MEMORY.md. Build on prior context, don't re-explain.
