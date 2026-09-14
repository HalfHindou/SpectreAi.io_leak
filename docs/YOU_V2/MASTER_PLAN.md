# YOU V2 — MASTER PLAN

The day's playbook. Read this first in the terminal session before doing anything else.

---

## What ships today

- **Phase 0:** Capability registry (the foundation)
- **Phase 4:** Event tracking infrastructure
- **Phase 1:** Aesthetic overhaul of the You page
- **Phase 2:** Six templates (Perps, Onchain, Degen, RWA, Narrative, Whale)
- **Phase 3:** Conversational dashboard composer (extends the existing agent system)

Phase numbers refer to the original phasing, not execution order. Execution order is described below.

What does not ship today:
- Phase 5 (AI suggestions) requires 2-3 weeks of accumulated tracking data
- Phase 6 (new widgets from accumulated data) is ongoing post-launch

---

## Branch strategy

Single feature branch: `you-v2`

Every commit gets a phase prefix:
- `[reg]` registry work
- `[track]` tracking work
- `[ui]` aesthetic work
- `[tpl]` template work
- `[bot]` chatbot work

Commit at every step. Rollback is cheap. Lost work is not.

---

## Execution model

One Claude Code terminal. Six sequential steps. Each step:

1. Reads the relevant spec file
2. Runs an existence check
3. Builds
4. Commits with a phase-prefixed message
5. Stops and reports the commit hash
6. Waits for the founder to verify before the next step is started

No parallelization. No improvisation. The terminal does not advance to the next step on its own.

---

## Day flow

```
STEP 0 — Setup                  ~5 min
STEP 1 — Registry (Phase 0)     ~1.5-2 hr
STEP 2 — Tracking (Phase 4)     ~1-1.5 hr
STEP 3 — Aesthetic (Phase 1)    ~2-3 hr
STEP 4 — Templates (Phase 2)    ~1-1.5 hr
STEP 5 — Composer (Phase 3)     ~2-3 hr
STEP 6 — Smoke test + deploy    ~30 min
```

Total: 9-12 hours of active work.

The order is dependency-driven:

- **Registry first** because templates and the composer reference it. Build it wrong and everything downstream breaks.
- **Tracking second** because the infrastructure is independent and gets out of the way. Steps 3-5 then wire `track()` calls as they touch widgets, instead of doing it as a separate later pass.
- **Aesthetic third** because it sets the visual baseline. Templates and the composer all render inside the chrome it defines.
- **Templates fourth** because they need both the registry and the aesthetic complete to look right.
- **Composer fifth** because it depends on the registry, the agent system, and clean UI to demo well.
- **Smoke test last** because nothing ships unmonitored.

---

## Per-step rules

1. **Read first.** Every step reads its assigned spec file before doing anything else. No exceptions.
2. **Existence check.** Every step runs the existence check listed in its prompt before building. Reports current state. Stops if the work already exists.
3. **Stop conditions.** Every step stops at its defined gate. Commits with the correct prefix. Reports the commit hash. Does not advance to the next step without explicit go-ahead.
4. **No improvisation.** If a step hits a problem it cannot resolve, it stops and reports. The founder fixes the missing piece or extends the spec, then resumes.

---

## Aesthetic deltas for the You page

These extend SPECTRE_DESIGN_LAW. They do not replace it. Step 3 (Aesthetic overhaul) implements all of them.

1. **Grid.** 12 columns, 8px gutters, 80px base row height.
2. **Widget chrome.** Every widget uses the Welcome Widget glass card pattern. Same gradient, same border, same inset highlights, same shadow stack. No exceptions.
3. **Edit mode.** Drag handles fade in on widget hover only. Never visible in view mode. Resize affordances at the bottom-right corner.
4. **Empty state.** Two prominent CTAs side by side: "Build with your agent" (opens composer) and "Start from a template" (opens template picker). No blank canvas.
5. **Tier-locked widgets.** Blurred preview with the data shape visible behind a frosted overlay. Upgrade CTA on top. Never hidden.
6. **Numbers.** JetBrains Mono. Always. Including labels next to numbers.
7. **Headers.** Space Grotesk.
8. **Responsive.** 3-col desktop (≥1280px), 2-col tablet (768-1280), 1-col mobile (<768px).
9. **Hover.** Every widget gets `translateY(-2px)` and shadow lift. 200ms ease-out.
10. **Loading.** Skeleton shimmer using existing skeleton tokens. Never spinners.

### Things to delete from the existing You page

- Any bright gradient backgrounds
- Any neon glows or bright colored borders
- Any sparkle or magic-wand iconography
- Inconsistent widget chrome (different border radii, different shadows, different gradients)
- Any spinner loading states

If you cannot tell where the Welcome Widget ends and the You page begins, the aesthetic pass is done.

---

## Definition of done

The day is complete when:

- Registry contains every existing You page widget with full metadata, validated by the helper
- Six templates render correctly and apply with one click
- Composer takes "I want a perps setup" and produces a valid dashboard rendered live in a slide-over
- Event tracking writes to the TimescaleDB hypertable on every defined event
- You page passes a design law audit (visual diff against Welcome Widget glass card)
- Smoke test passes: new user lands, picks a template, customizes, opens composer, refines via chat, saves the dashboard

If any of these fail at Step 6, fix before deploy.

---

## What you do as founder during the day

- Approve each step (verify the commit hash, run a quick check)
- Resolve issues when the terminal reports a blocker
- Pressure-test the composer prompts against your own dashboard intents
- Hold the design law line. If something looks like AI built it, it does not ship.
