# YOU V2 — TERMINAL PROMPTS (single terminal)

Six sequential steps. One Claude Code terminal. Run each prompt, verify the stop condition, then run the next.

Each prompt is self-contained. Each one reads its spec first, runs an existence check, builds, then commits and stops.

Do not skip steps. Do not skip the existence check. Do not let the terminal advance to the next step on its own.

---

## TIMING

| Step | What | Estimated time |
|------|------|----------------|
| 0 | Setup | 5 min |
| 1 | Registry (Phase 0) | 1.5-2 hr |
| 2 | Tracking infra (Phase 4) | 1-1.5 hr |
| 3 | Aesthetic overhaul (Phase 1) | 2-3 hr |
| 4 | Templates (Phase 2) | 1-1.5 hr |
| 5 | Composer (Phase 3) | 2-3 hr |
| 6 | Smoke test + deploy | 30 min |

Total: 9-12 hours of active work.

If you want a shorter day, defer Step 2 (tracking) to tomorrow. The pipeline can be added without touching anything from Steps 3-5. The composer in Step 5 will reference tracking event names but they will no-op until the hook exists.

---

## STEP 0 — SETUP

```
Set up the YOU V2 build.

1. Confirm working tree clean: git status
2. Check out branch: git checkout -b you-v2
3. Confirm /docs/YOU_V2/ contains: MASTER_PLAN.md, REGISTRY_SPEC.md, TRACKING_SPEC.md, TEMPLATES_SPEC.md, CHATBOT_SPEC.md, PROMPTS.md, README.md
4. Confirm SPECTRE_DESIGN_LAW.md exists at the repo root
5. npm install
6. Report: branch name, spec file count, dependency status

Do not write any feature code. Stop after the report.
```

---

## STEP 1 — REGISTRY (Phase 0)

```
You are building the YOU V2 capability registry. Phase 0. Foundation work.

READ FIRST in order:
1. /SPECTRE_DESIGN_LAW.md
2. /docs/YOU_V2/MASTER_PLAN.md
3. /docs/YOU_V2/REGISTRY_SPEC.md

EXISTENCE CHECK:
ls -la src/registry/ 2>/dev/null
test -f src/registry/widgets.json && echo "EXISTS" || echo "MISSING"
test -f src/registry/index.js && echo "EXISTS" || echo "MISSING"

If files exist with content, audit them. Do not overwrite. Extend.

TASK:
Follow REGISTRY_SPEC.md build process exactly.

1. Audit every widget that currently renders on the You page. Walk the source. Output the audit list to /home/claude/scratch/widget-audit.txt with file path, component name, data source, and current state.
2. Create /src/registry/widgets.json with a complete schema entry for every audited widget. Every field populated.
3. Create /src/registry/types.ts with the TypeScript schema definitions.
4. Create /src/registry/index.js exporting all five helper functions: getWidget, getByCategory, getByTier, search, validate.
5. Identify the top 5 widget gaps (widgets that should exist given Spectre's data but are not built). Add as DRAFT entries with status: "planned". Do not build them.
6. Run validate() on the full catalog. Zero errors required.

Use only categories from the canonical list in the spec.

STOP CONDITION:
git add . && git commit -m "[reg] capability registry: N widgets registered, M planned"
Report: commit hash, total widget count, list of gap widgets, any unusual findings from the audit.
Stop. Do not start Step 2.
```

---

## STEP 2 — TRACKING INFRASTRUCTURE (Phase 4)

```
You are building the YOU V2 event tracking pipeline. Phase 4.

Build only the infrastructure. Do not wire track() into widgets yet. That happens in Step 3 when widgets are touched anyway.

READ FIRST:
1. /docs/YOU_V2/MASTER_PLAN.md
2. /docs/YOU_V2/TRACKING_SPEC.md

EXISTENCE CHECK:
test -f migrations/youEvents.sql && echo "EXISTS" || echo "MISSING"
test -f server/routes/youEvents.js && echo "EXISTS" || echo "MISSING"
test -f src/hooks/useYouTracking.js && echo "EXISTS" || echo "MISSING"
psql $DATABASE_URL -c "\dt you_events" 2>/dev/null

TASK:
1. Create /migrations/youEvents.sql per the spec — hypertable, three indexes, compression policy at 7 days, retention at 275 days.
2. Run the migration. Verify hypertable exists: psql $DATABASE_URL -c "\dt you_events"
3. Create /src/utils/youEventTypes.js exporting the canonical YOU_EVENT_TYPES constant from the spec.
4. Create /server/routes/youEvents.js — POST endpoint, validation against canonical event types, validation against widget registry, 4KB per-event cap, 100-event batch cap, returns { accepted, rejected, errors }.
5. Create /src/hooks/useYouTracking.js — batches in memory, flushes every 5s or 50 events or on beforeunload via sendBeacon, IntersectionObserver pauses widget view duration when scrolled out, silent retry-once-then-drop on failure.
6. Wire the route into the Express app.
7. Manual test: fire one of each event type from a curl command. Confirm rows land. Confirm rejection of an invalid event type.

STOP CONDITION:
git add . && git commit -m "[track] you events pipeline live with hypertable"
Report: commit hash, count of test rows in the table, any rejection errors observed in the manual test.
Stop. Do not start Step 3.
```

---

## STEP 3 — AESTHETIC OVERHAUL (Phase 1)

```
You are doing the YOU V2 aesthetic overhaul. Phase 1. This is where design law enforcement happens.

READ FIRST in order, do not skip:
1. /SPECTRE_DESIGN_LAW.md
2. /DESIGN_SYSTEM.md
3. /src/index.css (the CSS variables, source of truth)
4. /src/components/WelcomePage.jsx (the design reference)
5. /src/components/WelcomePage.css
6. /docs/YOU_V2/MASTER_PLAN.md — read the "Aesthetic deltas for the You page" section carefully

EXISTENCE CHECK:
find src/components -name "YouPage*" -type f
find src/components -name "*Widget*.css" -type f | head -20
Report what exists.

TASK:
1. Audit the current You page against SPECTRE_DESIGN_LAW. Document every violation to /home/claude/scratch/aesthetic-audit.txt with file path, line, and what is wrong.

2. Apply fixes per MASTER_PLAN.md "Aesthetic deltas":
   - Standardize widget chrome on the Welcome Widget glass card pattern. Same gradient (168deg), same border, same inset highlights, same shadow stack. No exceptions.
   - Rebuild edit mode. Drag handles fade in on widget hover only. Never visible in view mode. Resize affordance bottom-right corner.
   - Rebuild empty state. Two CTAs side by side: "Build with your agent" (opens composer, will be wired in Step 5) and "Start from a template" (opens picker, will be wired in Step 4). Playfair Display for the headline. No blank canvas.
   - Rebuild tier-locked widgets. Blurred preview with frosted overlay showing the data shape behind. Upgrade CTA on top. Never hidden.
   - Replace any spinner with skeleton shimmer using existing skeleton tokens.
   - JetBrains Mono on every number, including labels next to numbers.
   - Space Grotesk on every header.
   - 12-column grid, 8px gutters, 80px row height.
   - Responsive breakpoints: 3-col desktop (≥1280px), 2-col tablet (768-1280), 1-col mobile (<768).
   - Hover: translateY(-2px) with shadow lift, 200ms ease-out, on every widget.

3. Delete on sight: bright gradient backgrounds, neon glows, sparkle/magic-wand iconography, inconsistent chrome, any spinner.

4. Wire useYouTracking calls into the touched widgets:
   - WIDGET_VIEWED on widget mount with IntersectionObserver-paused duration tracking
   - WIDGET_MOVED on drag end
   - WIDGET_RESIZED on resize end
   - WIDGET_ADDED on the add button
   - WIDGET_REMOVED on the remove handler
   - DASHBOARD_OPENED on YouPage mount

5. Visual diff. Open WelcomePage and YouPage side by side in the browser. The glass card treatment must be visually identical.

Use only icons from /src/icons/spectreIcons.jsx. Do not import Lucide, FontAwesome, or Heroicons.

STOP CONDITION:
git add . && git commit -m "[ui] you page aesthetic overhaul: glass chrome, edit mode, empty state, tracking wired"
Report: commit hash, the biggest visible changes, any violations from the audit you could not fix.
Stop. Do not start Step 4.
```

---

## STEP 4 — TEMPLATES (Phase 2)

```
You are building the YOU V2 templates. Phase 2.

READ FIRST:
1. /docs/YOU_V2/MASTER_PLAN.md
2. /docs/YOU_V2/TEMPLATES_SPEC.md
3. /src/registry/widgets.json (built in Step 1)

EXISTENCE CHECK:
test -f src/registry/templates.json && echo "EXISTS" || echo "MISSING"
test -f src/components/YouTemplates.jsx && echo "EXISTS" || echo "MISSING"

TASK:
1. Create /src/registry/templates.json with all six templates from the spec: Perps Trader, Onchain Analyst, Degen, RWA Investor, Narrative Trader, Whale Watcher.

2. Every widget_id in every template MUST exist in /src/registry/widgets.json. If a referenced widget is not registered, STOP and report. Do not invent widgets. Either pick a different widget that is registered or note the gap and stop for founder input.

3. Add validateTemplate(template) to /src/registry/index.js. Enforces: every widget_id valid, no overlaps, total fits 12-col grid, every widget respects min_size from the registry.

4. Run validateTemplate on all six. Zero errors required.

5. Create /src/components/YouTemplates.jsx — slide-over picker showing all six template cards. Each card: name, tagline, 16:9 preview area (placeholder gradient if no image), tier badge matching the existing tier badge style, Apply button.

6. Create /src/components/YouTemplates.css — Welcome Widget glass card pattern on every template card.

7. Wire the picker open trigger:
   - From the empty state CTA "Start from a template" (built in Step 3)
   - From a button in the YouPage header

8. Apply flow:
   - Confirm if the user has unsaved changes
   - Replace the dashboard layout
   - Fire TEMPLATE_APPLIED event via useYouTracking with template_id in payload
   - Show toast: "Applied {template_name}. You can customize anything."

STOP CONDITION:
git add . && git commit -m "[tpl] six archetypal templates with picker UI"
Report: commit hash, confirm all six apply correctly without errors, any widget gaps that forced template adjustments.
Stop. Do not start Step 5.
```

---

## STEP 5 — COMPOSER (Phase 3)

```
You are building the YOU V2 chatbot composer. Phase 3. The showpiece.

This is not a new chatbot. It is the user's existing agent (Phantom, Oracle, Cipher, Herald, Titan, Wraith) with dashboard composition as a new capability. The continuity is the differentiator.

Quality matters more than speed here. If smoke tests look weak, iterate before commit.

READ FIRST in order:
1. /docs/YOU_V2/MASTER_PLAN.md
2. /docs/YOU_V2/CHATBOT_SPEC.md
3. /spectre-agent-spec.md (existing agent personality)
4. /docs/AI_AGENT_SYSTEM_DOCUMENTATION.md (the 6 agent types and assignment logic)
5. /src/registry/widgets.json
6. /SPECTRE_DESIGN_LAW.md

EXISTENCE CHECK:
test -f src/components/YouComposer.jsx && echo "EXISTS" || echo "MISSING"
test -f server/routes/youCompose.js && echo "EXISTS" || echo "MISSING"
test -f server/services/widgetRegistry.js && echo "EXISTS" || echo "MISSING"
test -f server/services/composerValidator.js && echo "EXISTS" || echo "MISSING"
test -f server/services/composerPrompt.js && echo "EXISTS" || echo "MISSING"

TASK — backend first:

1. /server/services/widgetRegistry.js — loads /src/registry/widgets.json server-side, exports getRegistryForTier(tier) which returns widgets at or below that tier with status != "planned".

2. /server/services/composerPrompt.js — exports buildSystemPrompt({ agent_profile, user_profile, portfolio, watchlist, registry }). Use the template in CHATBOT_SPEC.md exactly. Substitute the user's actual agent type, motivation, risk profile, markets, info style.

3. /server/services/composerValidator.js — validates JSON output per CHATBOT_SPEC.md rules: valid JSON, widgets array length 1-8, every widget_id in registry, no overlaps, fits 12-col grid, respects min_size, rationale non-empty.

4. /server/routes/youCompose.js — POST endpoint:
   - Accepts { user_id, intent, current_layout, conversation_history }
   - Loads agent_profile, user_profile, portfolio summary, watchlist
   - Builds system prompt
   - Calls Groq llama-3.3-70b-versatile
   - Validates response with composerValidator
   - On validation failure, retries once with appended message: "Your previous response was invalid: {error}. Return strict JSON matching the schema."
   - On second failure, returns friendly fallback error
   - Returns validated dashboard JSON on success

5. Wire route into Express app.

TASK — frontend:

6. /src/hooks/useYouComposer.js — state management: slide-over open/closed, conversation history per dashboard, in-flight request, live preview rendering.

7. /src/components/YouComposer.jsx — slide-over per CHATBOT_SPEC.md visual structure. 480px wide on desktop, full-width on mobile. Slides in from the right.

8. /src/components/YouComposer.css — Welcome Widget glass card pattern on the entire slide-over container.

9. Agent header at the top: avatar using their assigned agent type colors (from AI_AGENT_SYSTEM_DOCUMENTATION.md), agent name, "Your agent" subtitle.

10. Example chips above the input: "Perps setup", "Whale watching", "Narrative trade", "On-chain alpha". Tapping a chip pre-fills the input.

11. Composer open triggers from:
    - The YouPage empty state CTA "Build with your agent"
    - A button in the YouPage header

12. Live preview: as the agent responds with a layout, render it immediately in the main YouPage area. The user sees the dashboard build live next to the chat.

13. Apply button: confirms unsaved changes, replaces layout, fires COMPOSER_APPLIED event, closes slide-over.

14. Wire tracking: COMPOSER_OPENED on slide-over open, COMPOSER_INTENT on submit, COMPOSER_REFINED on follow-up message, COMPOSER_APPLIED on apply.

SMOKE TESTS — required before commit:

1. "I want a perps setup" → returns 4-6 perps-leaning widgets in under 4 seconds
2. "Show me on-chain alpha" → returns whale, smart money, exchange flows
3. "Build me a degen cockpit" → returns new pairs, narrative, social, trending
4. After initial response, "add a funding skew chart" → adds widget without removing others
5. Validation failure path: manually corrupt one widget id in a Groq response, confirm retry path activates and resolves

If any smoke test produces weak output, do not commit. Iterate the system prompt. Re-test.

STOP CONDITION:
git add . && git commit -m "[bot] composer: agent-driven dashboard builder live"
Report: commit hash, smoke test results (which passed cleanly, which needed iteration), average response time across the five tests.
Stop. Do not deploy yet. Hand off to Step 6.
```

---

## STEP 6 — SMOKE TEST + DEPLOY

```
End-to-end smoke test. No code changes unless something breaks.

Manual test sequence:

1. Clear localStorage in the browser to simulate a fresh user
2. Land on the You page → empty state shows two CTAs
3. Click "Start from a template" → pick Perps Trader → confirm it renders
4. Customize: drag a widget, resize one, remove one
5. Open the composer ("Build with your agent" or header button) → type "make this more degen" → confirm preview renders
6. Apply the composer result → confirm dashboard updates
7. Refresh the page → confirm dashboard persists
8. Open browser DevTools network tab → close the tab → confirm tracking events flush via sendBeacon
9. Visual check: every widget chrome is identical to the Welcome Widget glass card

If all 9 pass:
   git push origin you-v2
   Open the Vercel preview URL
   Final visual check on the deployed preview
   If visual check passes, merge to main when ready

If any fail, fix on the branch before merging. Report which tests passed and which failed with details.
```

---

## NOTES

- If a step hits a problem the terminal cannot resolve, it stops and reports. Do not let it improvise. Add the missing piece manually or extend the spec, then resume.
- Commit hashes are receipts. Save them. Rollback is one command per phase.
- Step 5 is where quality matters most. The first impression of "your agent built this" sets the entire product narrative. Better to ship Step 5 tomorrow than to ship a mediocre version today.
- If a registered widget is referenced by a template (Step 4) or composer output (Step 5) but the underlying component is broken, fix it in line. The registry being correct does not guarantee runtime correctness.
- Hold the design law line throughout. Every step that touches UI gets visually checked against the Welcome Widget. If it does not match, it does not ship.
