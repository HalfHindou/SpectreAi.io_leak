---
paths:
  - "apps/research/src/pages/tokenized-assets/**"
  - "apps/research/api/_lib/handlers/extended-proxy.js"
---

# Tokenized Assets (/tokenized-assets) — page redesign spec

**Created:** 2026-08-03
**Owner:** Evgeniy
**Status:** SHIPPED to working tree 2026-08-03 (build clean, browser-verified desktop dark+day; NOT committed). See §G Execution log.
**Trigger:** "нужно лучше сделать визуальную часть страницы, нужно реорганизовать" — the page reads as 11 tabs of loosely stacked cards with duplicated content and dead zones.
**Scope:** the whole page — tab structure + Overview rebuild + visual polish. Frontend-only, no backend/API changes.

---

## A. Problems found (audit 2026-08-03, dev localhost:5180)

1. **Duplicated content on Overview:**
   - Spectre Brain text and "Editorial primer" open with the SAME sentence (both render the brain analysis).
   - RWA Screener (rows 1-12) and "Top Issuers (TVL)" (rows 1-14) sit side by side showing the same TVL-ranked protocol list.
   - Chain Breakdown card repeats what the Networks tab covers.
2. **Dead zones:** all 6 "Capital Rotation Themes" rows say "Flow data pending"; large empty areas under Editorial primer and under Top Issuers.
3. **The mid-page Brain block is a gray text wall** — market regime as a key/value table, long paragraphs, no visual hierarchy between the strong hero above and the screener below.
4. **Two donuts in a row** (Allocation + Net Flows); a donut is the wrong form for flows — inflow/outflow wants diverging bars.
5. **11 tabs** (Overview, Review, Stablecoins, Treasuries, Credit, Commodities, Networks, Platforms, Screener, Risk & Alpha) — heavy navigation, four of them (asset classes) are the same page shape.

## B. New tab structure (11 → 5)

```
Overview | Asset Classes | Infrastructure | Screener | Intelligence
              |                  |                        |
   [Stablecoins·Treasuries    [Networks·           [Review·Risk & Alpha]
    ·Credit·Commodities]       Platforms]
```

- Sub-sections = segmented pills inside the tab panel (same pattern as the existing Donut/Bars toggle). Sub-tab content stays the CURRENT tab components — wrapped, not rewritten.
- Old tab ids map to the new (tab, subTab) pair. Note: `activeTab` is component-local `useState('overview')` (NOT persisted), so the mapping only needs to cover internal references — the mobile `TABS` render, the legacy-modal switch cases, and any `setActiveTab('...')` call sites. Mobile `mta-tabs` renders the 5 top-level tabs; sub-pills scroll horizontally inside the panel.
- Lazy loading preserved: each sub-section keeps its own `lazy()` chunk.

## C. New Overview layout (top → bottom)

1. **Hero — unchanged.** ($27.53B + area chart + stats). Best block on the page.
2. **Three-card row:** Allocation donut (as is) · **Net Flows rebuilt as diverging horizontal bars** (inflow right `--bull`, outflow left `--bear`, net total prominent; 7D/30D/90D switch stays) · Chain Breakdown (as is).
3. **Brain card (one compact card, replaces the whole 2-column Brain block):**
   - verdict badge (e.g. CAUTIOUS BID) + regime chips row (Liquidity Adequate · Volatility Low · Yield Stable · Conviction Building) instead of the key/value table
   - bull/bear bullets in two mini-columns with green/red side rule
   - analysis text clamped to ~2 lines + "View Full Analysis →"
   - **Editorial primer: DELETED** (verbatim duplicate of the brain text).
   - **Capital Rotation Themes: conditionally rendered** — hidden while rows carry no flow data ("Flow data pending"); component stays in code and reappears when the backend ships flows.
4. **Screener block:** Top Issuers card is MERGED into the screener table (it was the same list); the freed right rail hosts the **7D Flow Board** (promoted from the bottom row). Filters, sorting, Load more must survive the merge.
5. **Bottom row:** RWA Pulse (news) + RWA Voices (tweets), two columns.

Result: page ~⅓ shorter, zero duplicates, zero dead zones.

## D. Visual rules

- **One card header template**: title + subtitle left, control (pills/toggle) right, same paddings everywhere. (Today every card has its own header variant.)
- Empty states: never "…pending" text walls — hide the block or show shimmer (design-system rule: no "Loading…").
- Day mode: every new/changed style gets its `.app.app-day-mode` counterpart (repo rule, no exceptions).
- No new chart libs — reuse `rwa-horizontal-bars`, `rwa-interactive-chart`, existing canvas/donut components.
- Mobile: Overview single-column order inherits the new desktop order; 5 tabs in `mta-tabs`.

## E. Out of scope

- Backend/serverless changes (rwa bundle tiers etc. stay as-is; see api-optimization-plan Wave 4/4b — do not disturb the tier=core/history split).
- Rewriting the inner content of Stablecoins/Treasuries/Credit/Commodities/Networks/Platforms/Review/Risk&Alpha tabs — they are wrapped under new parents, content untouched (cosmetic header alignment only where trivial).
- The legacy protocol modal vs AssetDetailPanel migration.

## F. Verification

- `npm run build:research` clean + `[check-critical-path] OK`.
- Browser pass on all 5 tabs (each sub-pill), dark + day mode, desktop + mobile width.
- Screener after merge: filters, sort, Load more, row click (drawer) all work.
- Old-tab-id references: every `setActiveTab(...)` call site and the legacy-modal switch land on the right (tab, subTab); no dead sub-pill.
- No commit/push without explicit go (standing rule).

---

## G. Execution log — shipped 2026-08-03 (working tree, NOT committed)

- **Tabs 11→5** — `TABS` now parent/sub (`classes`/`infrastructure`/`intelligence` carry `subs`); `activeTab` stays the LEAF id so `renderTab()` + the `useRwaData` gating (`risk-alpha`/`networks`) were untouched. New `SECTION_LABELS`/`PARENT_OF` maps; sub-pills `.ta-subtab-bar` (desktop) / `.mta-subtabs` (mobile), i18n keys `assetClasses`/`intelligence`/`review`/`sections` added to en-rest. `ta-tab-group-label` (the old "Infrastructure" divider) deleted.
- **Brain card** — new `rwa-brain-card.jsx` (prefix `rbc-`) merges the brain prose + regime (badge, top-right) + chips row + BULL/BEAR columns from the old pair; `rwa-brain-sidebar.jsx` and `rwa-thesis.jsx` DELETED (rbs__/rth__ CSS fully purged from all 3 css files; the shared card-chrome comma groups now carry `.rbc`). "View Full Analysis" now actually expands the prose inline (the old button was dead). Capital Rotation Themes render ONLY when a theme has real flow data (`themesReady` guard). Mobile shell renders the same card in place of RwaThesis.
- **Net Flows** — donut view replaced by `flows` view: diverging horizontal bars (outflow left `--bear`, inflow right `--bull`, net total on top); old `bars` view renamed `daily`; donut geometry/hover code + `rnf__donut/center/pulse` CSS deleted.
- **Screener row** — `rwa-top-issuers.jsx` DELETED (duplicated the screener list; all rti CSS purged incl. day-mode comma groups); the leaders rail now hosts the 7D Flow Board; the bottom intel row is 2-up (Pulse + Voices).
- **Verified:** `npm run build:research` clean + check-critical-path OK after every task; browser walk of all 5 tabs and every sub-pill (dark + day mode), zero console errors; data gating confirmed live (composability graph fetches only when Risk & Alpha opens); screener filters/Load more/sort intact.
- **NOT verified:** mobile tree in a live viewport — the session's Chrome window ignores `resize_window` (fullscreen trap) and an in-page same-origin iframe of `/tokenized-assets` gets redirected to `/` by the app (separate pre-existing behavior worth knowing: framed loads don't keep their route). Mobile changes are structural (same TABS maps, same components) and build-clean; needs one pass at ≤768px.
### Round 2 — the VISUAL pass (same day; round 1 was structural only)

Evgeniy: "разница практически незаметна" — correct, round 1 removed duplicates but never touched the visual language. Audited with live measurements, then fixed:

- **🪤 THE BIG ONE — every ranked bar on all 7 RWA tabs was invisible.** `rwa-horizontal-bars.jsx` sets `--bar-w` + `--bar-grad-top/bottom` + `--bar-border` inline (a comment even says "the gradient lives in CSS"), but **no CSS anywhere consumed them** — `grep -rn "var(--bar-w)" src` returned zero. Every fill rendered transparent at full track width, i.e. Chain Breakdown / Gravity Leaders / every ranked list showed empty grey tracks next to correct numbers. Regression from `9f2119c9` (memoization wave moved inline styles to custom properties and dropped the consuming half). Fixed by adding `width` + `linear-gradient` + an inset leading-edge to `.rwa-hbar-fill` (inset shadow, not a border, so it can't widen the element inside the `overflow:hidden` track). Verified proportional on Overview (7 bars) and Networks (10 bars).
- **Allocation card: donut → stacked share bar.** The 140px ring covered ~9% of its 502×389 card and its centre repeated the hero's `$27.53B` verbatim. Now: uppercase eyebrow → dominant leader share (`56.0%` at 1.9rem) → full-width stacked bar → legend. Hover still links bar ↔ legend. The grand total lives only in the hero now.
- **Net Flows: one column instead of a toggle.** Net is the card's headline (label above value, mirroring the allocation card), diverging bars under it, end labels on their own side of the axis, daily heartbeat always visible at the bottom. Killed the Flows/Daily toggle (it existed to fill space) and the 3-row legend (it restated the same three numbers a second time).
- **Composition row 389 → 344px**, `min-height` floor 340 → 280, shared internal rhythm (head → eyebrow → dominant number → chart → list) so the three cards read as one row. The allocation legend takes the slack from the taller chain card instead of leaving a void.
- **Palette: Chain Breakdown is one metric ranked, not categories** — swapped the 7-hue categorical rainbow for a single teal ramp that darkens with rank (`CHAIN_RAMP` / `CHAIN_RAMP_DAY` in `rwa-overview-tab.jsx`). The categorical palette stays on the allocation stack, which really is a composition of distinct classes.
- **Typography: audited, left alone.** The suspected inconsistency wasn't one — cards are all 0.95rem/600 and full-width sections 1.0625rem, a deliberate two-tier scale. Reported rather than churned.
- **Day mode:** two misses in the NEW code caught by measurement and fixed — `.rnf__end-name` (warm-white on white = invisible labels) and the spark's zero line (hardcoded `rgba(245,245,247,0.12)` inline → moved to `.rnf__spark-zero` with a day counterpart). A programmatic sweep of every new selector that sets colour/background now comes back clean except intentional semantic bull/bear + the teal live dot.
- **Verified:** build + check-critical-path green after each step; both themes on Overview; bars proportional on a second tab; zero console errors; zero dead class references left (`rbs__`/`rth__`/`rti__`/`rca__donut`/`rnf__views`/`rnf__legend`/… all gone), braces balanced in all 3 CSS files.

**🪤 Measurement trap re-confirmed:** the freshness pill reading "Loading…" forever in every screenshot is NOT a bug — the MCP tab is `document.hidden`, and the pill's ticker is behind that guard. Timestamps in state were fine. Don't chase it.

**Follow-up candidate (not done):** the other 6 tabs still colour their ranked bars from the categorical palette (visible in Networks → Gravity Leaders). Same single-hue argument applies, but changing them is a separate scoped pass.

- **Pre-existing bug spotted (not mine, not fixed):** Intelligence→Review tab renders raw i18n errors in two stat labels — `KEY 'TOKENIZEDASSETS.TREASURIES (EN)' RETURNED AN OBJECT INSTEAD OF STRING` (the review tab passes a namespace key where a leaf key is expected).
