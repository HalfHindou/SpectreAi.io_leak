# YOU V2 — BUILD KIT

Seven markdown files. Drop them all into `/docs/YOU_V2/` in your repo. Then follow the order in PROMPTS.md.

Single Claude Code terminal. Six sequential steps. No parallel work.

---

## File index

| File | Read when |
|------|-----------|
| **MASTER_PLAN.md** | Every step reads this first. The day's playbook, rules, aesthetic deltas, definition of done. |
| **REGISTRY_SPEC.md** | Step 1. Schema and build process for the widget catalog. |
| **TRACKING_SPEC.md** | Step 2. Event schema, hypertable, frontend hook. |
| **TEMPLATES_SPEC.md** | Step 4. Six templates with composition guidance. |
| **CHATBOT_SPEC.md** | Step 5. Composer architecture extending the agent system. |
| **PROMPTS.md** | The actual copy-paste prompts in execution order. |

---

## Day flow at a glance

```
STEP 0 — Setup                  ~5 min
STEP 1 — Registry               ~1.5-2 hr
STEP 2 — Tracking infra         ~1-1.5 hr
STEP 3 — Aesthetic overhaul     ~2-3 hr
STEP 4 — Templates              ~1-1.5 hr
STEP 5 — Composer               ~2-3 hr
STEP 6 — Smoke test + deploy    ~30 min
```

Total: 9-12 hours. If the day runs short, the natural break point is after Step 4. Composer (Step 5) is the showpiece and deserves a fresh head.

---

## Why this works

- **No overwrites.** Single terminal eliminates parallel write conflicts.
- **No invented widgets.** The registry is built first. Templates and the composer reference the registry. They cannot make up widgets.
- **No drift from design law.** Every step that touches UI reads SPECTRE_DESIGN_LAW first. The Welcome Widget glass card is the visual reference.
- **No black holes.** Every prompt has an existence check up front and a stop condition at the end. If something already exists, the terminal reports and stops instead of overwriting.
- **Commit hashes are receipts.** Every step produces a commit with a phase prefix. Rollback is one command.

---

## What you do during the day

1. Run the SETUP prompt
2. Verify the report → run STEP 1 → verify commit → run STEP 2 → verify commit → continue down the list
3. After STEP 5, run the smoke test in STEP 6
4. Push, deploy preview, final visual check

Hold the line on aesthetics. If something looks like AI built it, send it back.

---

## What does not ship today

- Phase 5 (AI suggestions) — needs 2-3 weeks of tracking data before it can do anything useful
- Phase 6 (new widgets from accumulated data) — ongoing post-launch

These are not delays. The data substrate has to exist before personalization is more than theater.
