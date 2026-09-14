---
paths:
  - "apps/research/src/**/*.mobile.css"
  - "apps/research/src/**/mobile-*.jsx"
  - "apps/research/src/pages/research-zone/**"
---

# Mobile PRO polish — HANDOFF

**Written:** 2026-08-04 (end of session) · **Author:** Claude session (Sunny's lane)
**State:** 9 commits on `main`, all deployed. Six reported issues still open — diagnosed, not fixed.
**Companion:** `pro-themes-and-scrollbars-handoff.md` (the theme system this builds on)

Read §5 before you touch git. Read §3 before you "fix" anything on this list.

---

## 1. What shipped (all on `main`, all live)

| Commit | What |
|---|---|
| `41c2a320` | Favorites = the watchlist; price centred; theme upload (one control, label-based picker) |
| `6008b37c` | Logo size picker — 250px mark into a 22px circle was ~19KB/logo |
| `515c449b` | **The page would not scroll**; RZ identity/hero seam; CC news toggle; top-coins inset; bottom bar 76→68 |
| `c5eafe03` | Panels became *lit* glass; pull mark tracks the finger; bar 68→62; glass top bar |
| `2c330789` | Loader rebuilt as a determinate SVG arc |
| `934657df` | **Undid a top-gap regression I shipped**; contained pill track; bar 62→56 |
| `679b397f` | RZ black tab slab; on-chain row off-window; pill track border closes |
| `d065b1809` | RZ perf table padding; link chip gap; audit of all four RZ tabs |
| `04ac5419e` | Themes in the mobile side drawer |

Plus **`spectre-tg-bot` `6b67345`** — the macro-wire geography gate, **deployed to the box** (scp + `pm2 restart`, verified online). `/opt` is not a git repo; I md5-diffed `subscriptions.js` against `HEAD~1` first and it matched, so scp was safe. There is a backup at `/opt/spectre-tg-bot/src/subscriptions.js.bak-pre-geo-gate`.

Test that ships with it: `node scripts/test-macro-gate.mjs` (23/23). It reads the shipping source directly, so it cannot drift. Run it after ANY change to that gate — it has now been tuned four times and each tuning risks silencing something that should fire.

---

## 2. Still open — what I measured, so you don't start from zero

> **UPDATE 2026-08-04 (theme-audit session, commits `224ac92ed`+`020181894`):**
> §2.1 FIXED (Solid now moves card/veil/surface/chip alphas with the plane; the
> founder made the product call — "glass or solid must match the options").
> §2.4 FIXED — the "microcaps" route is `/alt-rotation`; the overlap was the
> app-store-ready.css touch-target `min-width: 38px` defeating flexbox's
> min-content floor on EVERY mobile button (check that rule before any
> squeezed-strip bug). §2.5 FIXED (fullscreen container pays
> env(safe-area-inset-top)). §2.6 FIXED (stage grid auto-fits). §2.2 the
> converter/keyboard is STILL OPEN and still needs a real device. §2.3
> untouched. Also new that session: RZ tab bar moved under the chart, metrics
> into Overview; a spectral globe (right edge, both breakpoints) opens the
> Theme Studio.

Ordered by how much is already known.

### 2.1 Categories ignores the "Solid" data-panel setting — CAUSE FOUND, fix is a product call
Measured with `proDataPlane: 'solid'`: `--pro-a-plane: 0.93` and `.app` carries `pro-plane-solid`. Both correct. The problem is structural: **the Data-panels control only moves the PLANE alphas**, and any page whose cards are built on `--bg-surface` / `--bg-elevated` never reads those. So "Solid" is *incapable* of reaching a page that is not in the hand-written mobile plane list (`pro-theme-studio.css`, the `@media (max-width: 768px)` block).

Two ways out, and **Sunny needs to pick**:
- Make `pro-plane-solid` also raise `--pro-a-surface` / `--pro-a-card` / `--pro-a-elev`. Correct, one place, but it changes every PRO surface app-wide.
- Add the specific page's card classes to the plane list. Narrow, but the next page has the same bug.

### 2.2 Research Zone converter cuts the screen in half — NOT REPRODUCIBLE HERE
One run showed `.rzm` growing 3450 → 4185px on input focus; re-running the same steps showed **zero** growth — the first was content loading, not the focus. Desktop Chromium has no soft keyboard and no visual-viewport resize, so the actual iOS failure mode is invisible in this environment.

`.rzm` uses `min-height: 100dvh`, which is the usual suspect (iOS recomputes `dvh` when the keyboard opens). **Do not ship a guess.** This one needs a real device or Safari's responsive-design mode with the keyboard simulated.

### 2.3 Research Zone bottom gap — measured, looks correct in dev
`padding-bottom: 72px`, gap under the last content element = **72px**, which is exactly the nav reserve (`--m-bottom-nav-h: 56` + 16). Founder's screenshot shows something much larger. Either it is content-dependent (`.rzm-tab-content` ending well before its own bottom) or it needs the deployed build. No cause identified.

### 2.4 Microcaps "OTHERS2 OTHERS" labels overlapping — NEVER REACHED
`/microcaps` redirects to the landing page. **Ask Sunny for the real route** before spending time on it. The symptom in the screenshot is a tab strip whose labels run together with no gap and overflow the container — likely the same missing `gap` as the RZ link chip (`d065b1809`).

### 2.5 Cosmos fullscreen — top controls under the status bar — NOT REACHED
From the screenshot the toolbar sits beneath the iOS status bar (the clock overlaps the controls). Almost certainly a missing `env(safe-area-inset-top)` on the fullscreen layer. Cheap to fix once you find the right component.

### 2.6 RZ "numbers out of fields and weird boxes" — PARTIALLY fixed
`679b397f` killed the black tab slab that appears in all those screenshots, and `d065b1809` fixed the perf table and link chip. **Still unexamined:** the Spectre Score card sitting a third of the way across an otherwise empty bordered container, and the converter's field proportions.

### 2.7 Cosmetic inconsistency I introduced
The Top Coins sort-pill row is now a contained track (`934657df`). The **category chip row directly above it** (All / DeFi / AI / Meme …) still runs edge to edge, so the two rows no longer match. Not reported by the founder; left alone because "surgical" ruled out widening the change on my own judgement. Two-line fix if wanted.

---

## 3. Traps — every one of these cost real time

- 🪤🪤 **`touch-action: pan-x` blocks page scroll.** It permits ONLY horizontal panning from a touch starting on that element. Eight strips had it; a vertical drag from the market-pulse ticker or the CC tab row moved the page **0px**. Use `pan-x pan-y` — the browser still locks to one axis after the first movement.
- 🪤🪤 **A `position` override can undo `position: fixed`.** I added `position: relative` to `.mobile-header` (which is `fixed`) just to anchor a `::after`. My selector was (0,3,0) vs its (0,1,0), so the header fell into flow while `app-main-content` kept padding for a fixed header → **a double gap at the top of every page**, shipped and live for a round. `fixed` is already a positioned ancestor; the pseudo never needed it.
- 🪤 **A CSS mask fades the element's OWN background and border**, not just its content. Masking the pill track dissolved its right edge so the container never closed.
- 🪤 **`.mobile-header` measures 0px tall mid-hydration and 52px once mounted.** A probe catches either depending on timing. I chased that for a round; the rule now lists both it and `.mobile-header-inner`.
- 🪤 **`display: contents` elements have NO box** — they measure 0×0 and any padding on them is inert. `.discovery-filters-onchain-inline` is one; the gutter had to go on `.discovery-filters`.
- 🪤 **The full-bleed scroller trick (`margin: 0 -8px` + `padding: 8px`) breaks when the parent stops having padding.** It pulled the on-chain row to x=-7, genuinely off-window.
- 🪤 **`mobile-header.jsx`'s `renderLeftDropdown()` is DEAD MARKUP.** The hamburger calls `onOpenDrawer()` → `side-drawer.jsx`. Anything added to that dropdown renders nowhere.
- 🪤 **An SVG child rotates about the viewBox origin**, not its own centre — `transform-origin` is mandatory or a spinning arc swings off the element.
- 🪤 **`usePullToRefresh` had no `onTouchCancel`**, so an iOS-cancelled gesture left `touch-action: none` stuck on the page container. Fixed, but the same shape can recur anywhere a handler sets a style on touchstart.
- 🪤 **Verify by LOOKING, not only by computed style.** I shipped a loader using `round-logo.png` (the app icon — a black plate, reads as a hole inside a ring) and `logo-day-mode.png` (a 640×169 wordmark squashed into a 22px square). Both would have been obvious in a screenshot. There is **no transparent monochrome Spectre mark anywhere in the monorepo** — if you want the brand in a small control, an asset has to be made first.
- 🪤 The RZ pull-to-refresh was removed, not fixed: the gesture is suppressed whenever it starts on the chart, and the chart is most of that screen, so most drags did nothing. A control that silently fails is worse than none.

---

## 4. How to verify (the technique, not the scripts)

Everything above was measured with headed Playwright at 390×844, `deviceScaleFactor` 2–3, `isMobile: true`, against the dev server on `:5180`.

- **Touch gestures:** `context.newCDPSession(page)` → `Input.dispatchTouchEvent`. Playwright's `page.touchscreen` only taps.
- **Prod is behind the beta email gate** — you cannot measure `app.spectreai.io` logged out. Dev serves token logos same-origin too, so image timing has to be reasoned about from the CDN directly (`curl` the three CoinGecko variants).
- **Deploy check:** poll `https://app.spectreai.io/` for a change in `assets/index-*.js`. Takes ~140s. Then confirm YOUR code is in it by crawling the chunk list and grepping for a distinctive literal — a new hash only proves *a* build ran.
- **PWA service worker** keeps serving old chunks. "Not fixed on main" almost always means a stale SW, not a bad deploy.

---

## 5. ⚠️ Git — read before staging anything

`git status` shows **124 changed files that are NOT this work.** They belong to earlier sessions: the Baskets feature, the AI-brief `briefLabels`/`outlookIndex` threading, generated article JSON, and a `packages/server/index.js` route mount.

**Never `git add -A`.** Two files in particular are shared:
- `welcome-page.jsx` — carries the AI-brief session's hunks
- `en.json` — carries the Baskets session's `"baskets"` key

For those, stage only your hunks. The helper used all session:
```
git diff -- <file>            # split on ^@@, drop the foreign hunks
git apply --cached --recount  # apply the rest to the index only
```
The working tree is left untouched, so the other session's work stays dirty exactly as it was. Verify both directions afterwards: your change in `git show :<file>`, theirs still present in the file on disk.

**After every rebase, sweep for stale files.** `git reset --soft origin/main` leaves your working tree holding pre-merge copies of other people's files; committing one silently reverts their work. This bit twice (Evgeniy's `tokenPairsCache`, then 18 trading files). The check:
```
git diff --name-only <old-main>..origin/main > /tmp/inc.txt
git status --short | awk '{print $2}' | sort > /tmp/dirty.txt
comm -12 <(sort /tmp/inc.txt) /tmp/dirty.txt
```
For each hit, compare against the OLD main: identical = merely stale, safe to `git checkout origin/main -- <file>`; different = it has local edits, MERGE instead (extract the local-only diff with `git diff <old-main> -- <file>`, checkout theirs, re-apply).

Main moved four times mid-session (Evgeniy's chart PRs). Rebase by cherry-picking onto `origin/main` **in a throwaway worktree**, build there, push from there — the 124 dirty files are never touched.

---

## 6. One-paragraph summary

Nine commits shipped and deployed: the page not scrolling (two independent causes), the PRO glass reading as flat grey boxes, a loader that jumped between two states, the bottom bar down 26%, a top-gap regression I shipped and then undid, and a run of edge/padding defects across Top Coins, the Research Zone and the on-chain view. Six reported issues remain — one has its cause found and needs a product decision (§2.1), one cannot be reproduced without a real iOS device (§2.2), one measures correct in dev (§2.3), and three were never reached (§2.4–2.6). The single most dangerous thing you can do in this repo right now is `git add -A`.
