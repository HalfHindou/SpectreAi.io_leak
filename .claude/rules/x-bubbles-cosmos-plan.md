---
paths:
  - "apps/research/src/pages/x-bubbles/**"
  - "apps/research/src/pages/x-intelligence/**"
  - "apps/research/src/pages/bubbles/**"
---

# X Bubbles × Cosmos Engine — Handoff & Improvement Plan

**Created:** 2026-07-10 (end of the 15-round Spectre Cosmos build)
**Author:** Claude session (Sunny's lane) — cosmos shipped through `df04746e` on main
**Status:** PLANNING — work was explicitly HELD by Sunny ("wait before u do x bubbles… finish this and dont do x bubbles. once u done tell me then ill plan next move"). This doc is the handoff he asked for.
**Goal:** rebuild the X Bubbles experience (KOL ↔ project social universe) on the new three.js Cosmos engine — "x bubbles allows to see the world of kols and projects. go big baby."

---

## A. THE NAME-SWAP TRAP (read first, verified in code 2026-07-10)

The route names and folder names are **crossed** (2026-06-14 swap, comment at `apps/research/src/App.jsx:451-456`):

| Sidebar label | URL | Component folder | State |
|---|---|---|---|
| Social Intelligence (public) | `/x-intelligence` | `pages/x-bubbles/` (`x-bubbles-page.jsx`, 2,070 lines, `useLeaderboard`) | **UNLOCKED** — leaderboard/bubble dashboard on `/v1/social/x-bubbles` data |
| **X Bubbles** (the target) | `/x-bubbles` | `pages/x-intelligence/` (~7,950 lines) | **GATED** in `comingSoonPages.js` (`'x-bubbles'` in `COMING_SOON_PAGE_IDS`) |

**The thing Sunny wants improved = the gated legacy graph at `/x-bubbles` = `pages/x-intelligence/`.** It's the KOL↔project force graph: `XIntelligencePage.jsx` (1,176) + `GraphCanvas.jsx` (1,120, 2D canvas force sim) + `EntitySidebar` (943) + `MentionChart` (582) + `FilterPanel`, `CrawlSidebar`, `FlightControls`, `AmbientGlow`, `ListView`, etc.

**To see it in dev:** the gate blocks even direct URLs (`<ComingSoonGuard>` in App.jsx). Temporarily remove `'x-bubbles'` from `COMING_SOON_PAGE_IDS` — do NOT commit that edit unless Sunny says to unlock.

## B. What exists today (both halves)

### B1. The legacy graph (`/x-bubbles`, pages/x-intelligence/)
- **Data:** `hooks/useCrawlGraph.js` — bootstrap-seeded KOL↔project graph. `SEED_MODES` (default `trending24h`), `DEPTH_MODES` (standard = 1 detail page/project, deep = 3). Progressive render + 30-min localStorage seed (`spectre-xintel-crawl-v1:`) + bounded enrichment shipped in api-optimization Wave 6 — first paint = 1 request, full galaxy ≈ 3s, ~6 `/api/xdash/token/{id}` calls.
- **Graph shape** (`buildCrawlGraph`, line 256): returns `{ nodes, links, … }`.
  - **Project nodes:** `{ id, cgId, name, symbol, handle, cashtag, avatar, type:'project', isProjectHub, tier:'S', authenticity (0-100 clean-signal), followers (=unique_authors, radius blend), mentionCount (external_mentions_24h), weightedEngagement, twitterUrl, primaryCategory, segment, intel:{mentions24h, authors24h, weightedEngagement24h, attentionQuality{clean_signal/promo_share/handle_only/cashtag_only}, velocity, latestMentionAt}, velocityScore (velocity_ratio, 1.0=flat) }`.
  - **KOL nodes:** `{ id, name, handle, avatar (_200x200), type: detectType(author), followers, … }` — KOLs attach to projects via `links` (edge weight = mention overlap); `projectAdjacency` gives project↔project co-mention weights.
  - 🪤 Bootstrap has NO 7d mention field (`mentions7d` always null); `unique_authors` is all-time, `unique_external_authors_24h` is the real 24h count.
- **Render:** `GraphCanvas.jsx` 2D force sim (`useForceSimulation`, `useGraphInteraction`) — the thing the Cosmos replaces.
- Also exists, unrouted: `pages/x-bubble-maps/` (18 jsx) — older WIP, ignore.

### B2. The Cosmos engine (shipped, `pages/bubbles/components/cosmos/`, 5,084 lines total)
Vanilla three.js v0.183 (NO R3F), fully lazy (`check-critical-path.mjs` guards: three must never land on the boot chunk — entry stays ~0.31MB raw).

| File | Lines | Role |
|---|---|---|
| `cosmos-engine.js` | 1,756 | `CosmosEngine` class — scene, sprites, camera rig, picking, drag, tweens, textures, day mode, thermals |
| `cosmos-data.js` | 696 | pure builders: tokens → `{sun, bodies, groups}`; sector/social variants; chain/sector maps |
| `cosmos-view.jsx` | 1,367 | React HUD: view/source/labels segs, search, watchlist, share, explainer, chain filter, dossier, SocialPanel |
| `cosmos.css` | 1,265 | glass HUD + day mode + mobile |

**Engine public API** (header at engine.js:18): `setData({sun,bodies,groups})` · `setView('solar'|'map'|'galaxy')` · `focusBody(id|null)` · `setCinematic(b)` · `setSpeed(x)` · `setDayMode(b)` · `setLabelMode(mode)` · `setRunning(b)` · `nudge({yaw,pitch,zoom,panX,panY})` · `snapshot()` (sync render→dataURL) · `resetCamera()` · `resize()` · `dispose()`. Debug handle: `.cosmos-stage.__cosmosEngine`.

**Body contract** (what `setData` bodies need, from `buildCosmos`): `{ id, token, change, group, groupColor, radius, mcapNorm, orbitRadius, orbitJitter, phase, incline, inclinePhase, speed, dir, seed }`. Suns: `{ id, token, change }`. Groups (galaxy view): `{ key, color, count, members[] }` + `layoutGalaxy` adds cluster centers/ring radii.

**Features already built (all reusable for X Bubbles):** 3 views (Orbit 3D / Map 2D / Galaxy clusters + constellation lines); screen-space picking (`_pickAt`, nearest-within-halo — Gleb's far-bubble fix); grab-and-drag bodies (ray-plane, springs home); golden-angle `respacePhases` de-clustering; label declutter by screen radius + label modes (% / price / mcap / name / off); hover card + click dossier + fly-to; search-jump across universes; cinematic mode w/ exit; explainer panel ("why near/far from sun", auto-once via `spectre-cosmos-onboarded`); per-chain filter; share-to-X poster (snapshot + insight chips, Web Share API w/ files on touch); day mode (`_applyDayLook` re-blends Additive↔Normal); GPU thermals (antialias off, DPR cap 1.5/1.25, ~40fps governor uncapped during interaction, 5-min idle stop via `idleManager`, tightened glows); mobile CSS.

**There is already a "social" universe** in the bubbles Cosmos (`buildSocialCosmos` = X Dash top-25/50/100 leaderboard, mentions-based) — but it's **flat tokens around one sun**. X Bubbles is a different shape: a **two-level hierarchy** (projects as planets, KOLs as moons) + project↔project co-mention edges. That's the new work.

## C. The build sketch (what "go big" means)

### C1. Engine extension: hierarchical orbits (moons) — the one real engine change
The frame loop currently targets every body around `_SUN_POS` (0,0,0). Add `body.parentId`:
- Moon target = `parent._pos` + its own orbit offset (reuse the same orbit math, smaller `orbitRadius` scaled to parent radius, faster `speed`).
- Resolve parents once in `setData` (map id→body), tick parents before moons (sort bodies: parentless first).
- Picking/drag/labels/hover need zero changes (they iterate `_bodies` generically). Drag a planet → its moons follow (free, since moons chase `parent._pos`).
- Galaxy view: cluster = project + its KOL swarm; `layoutGalaxy` already sizes rings from member radii.

### C2. Data adapter: `buildKolCosmos(nodes, links)` (new fn in cosmos-data.js or a sibling `xbubbles-data.js`)
- **Sun:** the seed's top project (highest weightedEngagement or mentionCount) — or a neutral "X" core if Sunny prefers no project favoritism.
- **Planets = projects.** Size = log(weightedEngagement || mentionCount) (KOL graph has no mcap!). Orbit = velocityScore (rising = closer, like gainers) — this keeps the explainer story coherent ("attention pulls you toward the core"). Color = `authenticity` ramp (organic green → noisy red, the legacy hub-color semantic) or `primaryCategory` group color — pick ONE, put the other in the label/dossier.
- **Moons = KOLs**, `parentId` = their strongest-edge project; KOLs mentioning multiple projects orbit the strongest and keep the rest as constellation lines. Moon size = log followers; `detectType(author)` archetype → moon tint.
- **Constellation lines:** reuse the galaxy-view `LineSegments` for (a) project↔project `projectAdjacency` edges, (b) optionally hovered-KOL → all its projects.
- **Avatars:** KOL `avatar` URLs are pbs.twimg.com — test CORS in the chip texture path; the existing letter-fallback chip already handles failures. 🪤 strip `?query` before fetching (the CG-CDN 503 lesson generalizes).

### C3. View layer: new page wiring, keep the HUD
- Fork or parametrize `cosmos-view.jsx`: sources become seed modes (Trending 24h / …from `SEED_MODES`), depth toggle (standard/deep), KOL-type filter replacing the chain filter, count pills = projectCount (20/50).
- Dossier: project click → the existing `EntitySidebar` intel (mentions/authors/quality bars/velocity) rather than the market dossier; KOL click → handle/followers/archetype + link to X. `intel` payload is already on the node.
- Keep: search, labels, cinematic, share (poster reads "X BUBBLES · KOL universe"), explainer (rewrite copy: near = rising attention, size = engagement, moons = the voices carrying it), day mode, mobile.
- **Promote the engine to shared:** cosmos currently lives in `pages/bubbles/components/`. Coding standards: used by 2+ pages → move to `src/components/cosmos/` (engine + data + css; view stays per-page). Do this as its own commit BEFORE the feature so the diff stays reviewable. Update the bubbles imports; build must stay green on check-critical-path (both pages lazy-load it).

### C4. Suggested phases
1. **Prep PR:** promote engine to `src/components/cosmos/` + add `parentId` moon support (behind "no `parentId` = old behavior", so /bubbles is untouched). Verify /bubbles still perfect.
2. **X Bubbles MVP:** new cosmos view inside `pages/x-intelligence/` (a view toggle next to the legacy graph, or replacing it — Sunny's call), `buildKolCosmos`, project dossier, KOL moons, explainer copy.
3. **Go-big pass:** co-mention constellation lines, KOL-type filter + archetype legend, seed/depth controls, share poster, cinematic tour hitting top-5 projects.
4. **Kill or keep the legacy canvas** + unlock decision (`comingSoonPages.js`) — Sunny decides.

## D. Traps carried from the 15-round Cosmos build (all verified the hard way)

- 🪤🪤 **Hidden/occluded Chrome tabs render ZERO WebGL frames** — CDP screenshots time out AND motion mechanics can't be probe-verified (springs-back reads trivially true). Verify static data via `.cosmos-stage.__cosmosEngine` DOM probes; verify motion only on a visible tab.
- 🪤 **:5180 belongs to `/Users/sunny/spectre-liquidity-wt`**, not spectre-app. This session's server: **:5186** from `/Users/sunny/spectre-app`. Always verify which tree a port serves before trusting what you see.
- 🪤 `/api/xdash/bootstrap` silently caps `per_page` at 50 → deeper lists = stitched pages (see the top-100 fix in cosmos-view's `xdashData2` memo).
- 🪤 CoinGecko/CDN images 503 CORS requests carrying `?query` — `cleanLogoUrl = src.split('?')[0]`.
- 🪤 Module-scope view-state persistence (`_lastView` etc.) resets under HMR — looks like a bug in dev, isn't.
- 🪤 World-space label offsets drift sideways at camera azimuths — use `sprite.center` screen-space anchoring (already in engine).
- 🪤 Additive blending washes white on day backgrounds — any NEW sprite/material must be registered in `_applyDayLook`.
- 🪤 TDZ crash class: hooks/vars referenced in dep arrays before declaration pass the build but crash at runtime — smoke-test the page after every view edit.
- Git: Sunny pushes DIRECT to main (`git push origin HEAD:main`, never `engineering`); `git pull --rebase --autostash origin main` first (parallel sessions land commits); `-c commit.gpgsign=false`; commit msgs via `-F /tmp/file` (heredocs break on quotes); lint-staged blocks `console.log`.
- PWA service worker caches old bundles on prod — "I don't see it" = hard-refresh (Cmd+Shift+R).
- `npm run build:research` + green `[check-critical-path]` line after every round; entry must stay ~0.31MB raw.

## E. Open decisions for Sunny (ask before Phase 2)

1. **Replace or coexist?** Cosmos as the new default at `/x-bubbles` with the legacy force graph behind a toggle, or full replacement (deletes ~2.3k lines of GraphCanvas/force-sim)?
2. **Sun semantics:** top project as the sun, or a neutral core (no project favoritism)?
3. **Planet color channel:** authenticity ramp (legacy semantic, unique to this page) vs category colors (consistent with /bubbles)? Recommend authenticity — it's the page's superpower.
4. **Unlock timing:** does this ship gated (team-only polish) or unlock `/x-bubbles` when the MVP lands?
