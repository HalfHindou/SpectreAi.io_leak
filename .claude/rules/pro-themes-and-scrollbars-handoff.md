---
paths:
  - "apps/research/src/components/pro-theme/**"
  - "apps/research/src/index.css"
  - "apps/research/src/pages/lite/**"
  - "apps/research/src/components/layouts/**"
---

# PRO Themes + Scrollbars — handoff

**Written:** 2026-08-02 · **Author:** Claude session (Sunny's lane)
**Status:** Theme Studio is branch-only, feature-complete, awaiting Sunny's product calls (A9).
**Scrollbars: the shipped fix (`71579159`) targeted the WRONG CAUSE — read PART B0 before touching anything.** Updated 2026-08-02.
**Branch:** `claude/pro-themes-test` (pushed) · **Worktree:** `~/spectre-pro-themes-wt` · **Dev URL:** http://localhost:5190 (LAN: http://172.16.0.76:5190)

---

# PART A — PRO THEME STUDIO

## A1. What it is

Sunny asked: *"can Spectre Pro have themes and glass and paper mode like Lite?"* Answer: yes, and it's built.

Rather than a mock side-page, the **real PRO app** runs from an isolated worktree with a Theme Studio injected into `AppShell`. Every page keeps its full chrome (top nav, sidebar, Command Center, RZ tabs, rails) while the look swaps underneath. Three looks:

| Look | What it does |
|---|---|
| **Spectre** | The stock dark app. Default. |
| **Glass** | Frosted translucent surfaces over a photo/gradient/aura backdrop. The whole LITE backdrop catalog (~90 swatches: Scenes, Cosmos, City nights, Colour studies, Gradients, Auras, Solids, Bright & airy, Crypto brands, Art styles, Fun & pop) + Daily mix + your own photo upload. |
| **Paper** | apple.com-style light: rides the app's existing day-mode counterparts + a pearl/pattern canvas + airy white chrome. 16 paper canvases + 14 patterns. |

Plus **Glass depth** (Clear / Standard / Deep — how much backdrop reads through) and **Soft focus** (blur + dim the backdrop for dense reading).

## A2. Where the code lives

```
apps/research/src/components/pro-theme/
  pro-theme-studio.jsx     fab + ProThemeBackdrop (boot path, small)
  pro-theme-panel.jsx      the picker sheet — CODE-SPLIT, loads on first fab click
  pro-theme-studio.css     all skins + every fix pass (sections are numbered 1-17)
apps/research/src/pages/lite/components/
  lite-backdrops.js        the backdrop catalog + resolvers, EXTRACTED from lite-page.jsx
                           (lite-page re-exports it, so LITE is behaviourally unchanged)
apps/research/src/components/layouts/app-shell.jsx   class wiring + backdrop mount + dayMode sync
apps/research/src/store/useSettingsStore.js          persisted keys
apps/research/src/components/trading-chart.jsx       canvas plane goes translucent under a theme
scripts/theme-audit/                                  the audit tooling (see A5)
scripts/theme-wallpapers/                             4K wallpaper pipeline (see A6)
```

**Store keys** (persisted + in `partialize`): `proThemeLook` (`off|glass|paper`), `proThemeBg` (`{mode,scene}`), `proThemePaper`, `proThemeDepth` (`clear|standard|deep`), `proThemeFocus` (bool), `proThemePrevDay` (bool — see trap T1).

**CSS scopes:** `.app.pro-glass`, `.app.pro-paper`, `.app.pro-bright` (glass on a white backdrop → daylight treatment), `.app.pro-depth-clear|deep`, `.app.pro-focus`.

## A3. Running it

```bash
cd ~/spectre-pro-themes-wt/apps/research && npx vite --port 5190   # UI
cd ~/spectre-pro-themes-wt && node packages/server/index.js         # API on :3009
```

⚠️ **Three worktree-local files are deliberately NEVER committed** (they'd break other checkouts):
- `.env` — `PORT=3009`, plus `HETZNER_BARS_SERVE=1` + `CODEX_FIRST_BARS=0` (see A7)
- `.claude/launch.json` — server port 3009 so `vite.config.js` proxies `/api` → :3009
- `apps/research/vite.config.js` — `server.fs.strict: false` (node_modules is a symlink, fonts 403 without it)

Keep them stashed/uncommitted. `git stash push .claude/launch.json apps/research/vite.config.js` before any merge, pop after.

## A4. What was fixed, in order (each was a founder review round)

1. **Blending** — the canvas chart painted an opaque plane; now translucent under a theme (`trading-chart.jsx` palette is theme-aware). TradingView's iframe **cannot** go transparent → framed as a deliberate dark media card instead.
2. **Per-page sweep** — 21 pages scanned for opaque-dark slabs; fixed ventures (opaque page root), intelligence hero, RWA's whole `--ta-glass-bg` card family, x-dash cmdbar, heatmaps hero, news tabs, ROI panel, etf-flows cards.
3. **Glass depth** control.
4. **Restore bug + resilient backdrops + Daily mix + photo upload + Soft focus + lazy panel.**
5. **Full-app audit** — every routed page, both looks, tab-deep (RZ, RWA's 12 tabs, Traders Corner, Liq Heatmap views, X-Dash, Calendar) + article readers. 30+ pages clean.
6. **Ghost panels** (the inverse problem) — Traders Corner and 10 other pages build panels as ~0.03-alpha white on the black void, so they VANISH over a photo. Frosted.
7. **Readability** — luminous `--bull`/`--bear`, lifted text alphas, a denser **data-plane floor** for tables vs mood surfaces, pills turned from 0.35-alpha ghosts into real chips, floating-text audit over 24 pages.
8. **Scroll perf** — see trap T4, the most important one.
9. **Mobile** — 390px, both looks, 12 pages.
10. **The BRIGHT skin (2026-08-03)** — see A10. Every white swatch was rendering dark slabs; the skin now mixes every plane from one ink token.

## A10c. THE REAL CAUSE, found 2026-08-03 evening — day mode never remapped the TEXT RAMP

Founder, on the bright themes with a screenshot of the X-Dash brief: *"some pages
in brighter themes arent optimised, here i see no text. also notice left side if
i scroll a whole white page overlays."* Two independent bugs, both measured.

### (1) "I see no text" — the ink was never flipped

`.app.app-day-mode` remapped a handful of hairline vars but **not
`--text-primary … --text-muted`**. So the only surfaces that read in day mode
were the ones a human had hand-written an `.app.app-day-mode .x { color: … }`
counterpart for; anything styled the ordinary way (`color: var(--text-tertiary)`)
printed warm-white on a white card. Bright PRO themes force day mode, so that is
the founder's "no text" — and it was equally broken in plain day mode all along.

Measured with a contrast scanner over 22 routed pages (composites the real
ancestor background, flags `cr < 1.6` both ways):

| | before | after |
|---|---|---|
| invisible text nodes, 22 pages | **201** | **~40**, all pre-existing/other classes |
| `/x-dash` board | 90 | 0 |
| X-Dash fullscreen drawer | 91 | 0 |
| `/categories` | 36 | 0 |
| `/tokenized-assets`, `/private-markets`, `/watchlists`, `/`, `/monarch-chat` | 13 / 5 / 0 / 0 / 0 | 0 |

Fixes, in order of leverage:
- **`index.css` — the ramp flips under `.app.app-day-mode`.** One change, every
  `var(--text-*)` consumer in the app. The inverse risk (surfaces that stay dark
  in day mode) was measured the same way across all 22 pages: exactly **one**
  new dark-on-dark, `.btn-secondary` (it sits on `--glass-bg`, a near-opaque
  black that does not move in day mode) — given the day-mode counterpart it
  should always have had. Monarch's deliberately-dark panels (trap T8) were
  re-measured and are unaffected; they set explicit colours.
- **Hardcoded ink needs explicit counterparts.** ~105 rules in
  `x-dash-page.css` (plus alt-rotation / ventures) write `rgba(245,245,247,α)`
  or `#f5f5f7` instead of the tokens, so no ramp reaches them. Generated,
  alpha-matched counterparts now live at the end of each page's day-mode sheet.
  🪤 In the FULLSCREEN drawer these are 4-5 classes deep
  (`.xd-drawer.xd-drawer--fullscreen .xd-carrierboard__list .xd-carrierrow
  .xd-carrierrow__name`), so they also **outranked** the day-mode counterparts
  that already existed higher up the file — which is why a carrier name was
  invisible in the brief but fine in the side drawer. Specificity, not coverage.
- **`XDMomentumNative` (the hand-drawn momentum SVG) never went through
  `useChartPalette`** — every hairline, tick and the price line was a literal
  white, so on a light skin the chart lost its axis. Now flips with `dayMode`;
  the two series colours (cyan/amber) read on both and stay put.
- **Pale day-mode choices**, not missing ones: `/categories` painted its rank
  column `#cbd5e1` in day mode. Darkened to `#64748b`.

### (2) "a whole white page overlays when I scroll" — the portal wrapper had a BOX

The X-Dash drawers portal into `<body>` and re-use the `app` class so their
subtree still matches `.app.app-day-mode …` / `.app.nav-sidebar-* …`. But `.app`
is also a LAYOUT class (`App.css`: `display:flex; min-height:100vh; width:100%`
+ a day-mode background). Measured: the wrapper was a **1700×950 box at y=950**,
i.e. a second full viewport appended after the real app — the document was 2×
the viewport and scrolling revealed an empty `#f5f5f7` slab. It also sat over
the nav strip and ate its clicks.

Fixed with `.xd-portal-root { display: contents }` — no box, no background, no
hit-testing, while the class hooks keep matching (selector matching is DOM-based,
not layout-based) and the `position: fixed` drawer is unaffected. Verified:
document height 1900 → 950, drawer geometry byte-identical, nav clickable again.

🪤 **A portal that re-uses `.app` inherits `.app`'s LAYOUT, not just its theme
hooks.** If you need theme classes on a portal, carry them on a box-less element.

### (3) The portal was also missing the PRO skin

`portalClass` mirrored `app` / `app-day-mode` / `nav-sidebar-*` but not
`pro-paper` / `pro-glass` / `pro-bright`, so inside a themed app the drawers
rendered unskinned. New `use-pro-theme-skin.js` resolves the skin once (incl.
the lazily-loaded `isBrightBg`) and is consumed by **both** `AppShell` and the
two drawers, so they cannot drift.

**Left alone deliberately** (reported, not fixed): `.xd-treemap__cell-rank-delta`
is `--bull-bright` green on a bull-green treemap cell — equally unreadable in
DARK mode, so it is a design call (chip vs halo), not a theme bug. And
`--bull-bright` (#34D399) on white sits at ~1.9 contrast app-wide: legible but
weak. A day-mode remap to #059669 was A/B'd and changes nothing about
visibility, so it is a polish call for the founder, not a fix.

**The tooling** (`scripts/theme-audit/` siblings, kept in the session
scratchpad): a Playwright contrast scanner that composites the real ancestor
background and reports BOTH directions. 🪤 Its first version treated one
translucent layer as opaque (`over()` returned `a: 1`), which made every
`rgba(15,23,42,0.035)` chip read as a black slab and produced a page of
phantom "dark-on-dark" findings. Source-over must accumulate alpha.
🪤 It reads `color`, which is meaningless for SVG `<text>` — check `fill`.

## A10b. CORRECTION, same day — bright backdrops now run the PAPER skin

A10 below fixed the bright look by inverting the glass skin surface-by-surface
(one ink token instead of ~30 hardcoded near-blacks). It worked and it measured
clean — but it was the wrong altitude. Founder: *"i think you over complicated
it. Paper is perfect. the bright ones are like paper but with the other
backgrounds."*

So `AppShell` now emits **`pro-paper pro-bright`** (not `pro-glass`) whenever the
chosen backdrop is bright. Same light, day-mode-native treatment the founder
already signed off on, with the chosen wallpaper behind it instead of the pearl
canvas. The backdrop layer is untouched — it still resolves the wallpaper from
the stored `glass` look and paints the white scrim. Every `.pro-glass.pro-bright`
rule was deleted as dead; `.pro-bright` now only ever appears next to
`.pro-paper`.

Why keep A10's ink work: it is what the **dark** glass skin runs on now, and it
is why Depth/Data-panels compose instead of fighting. It is no longer what makes
bright light.

Verified after the switch: bright sweep over 13 pages + tabs finds no dark planes
— only gradient TEXT, day-mode primary buttons, and the liquidation heatmap's
deliberately-dark canvas card (which picks up Paper's media frame for free).

The 24 bright swatches were locked in the picker for one release (`71888f44`)
while this landed, then unlocked. Re-lock recipe is in the comment above
`Swatch` in `pro-theme-panel.jsx`.

## A10. THE INK — the first attempt at the bright themes, 2026-08-03 (superseded for bright, live for dark)

Founder, on Frost: *"some themes in pro aren't optimised. this looks terrible on the
panels… it didn't optimise for these bright versions"* + *"all these white ones need to
be fixed"* (Pure White / Ivory / Snow White / Bone / Cloud Gray / Linen, the whole
Bright & Airy photo pool, and the ten light gradients).

**Root cause.** `.pro-bright` remapped the design-system TOKENS (`--bg-surface`, …), so
every var-driven component turned white on a bright backdrop. But this file also carried
~30 rules that HARDCODED their own near-black `rgba()` with `!important` — the hero stat
band, the top-coins tab strip and table plane, the sticky table header, every `tc-card`,
the RWA card family, the watchlist header/metrics, the heatmap/treemap planes, the chart
containers. None of them had a bright counterpart, so on a white wallpaper they stayed
black — with the page's own day-mode (dark) type printed on them. Measured before the
fix, at `g-frost`: **4 dark slabs on home, 9 on traders-corner, 7 on tokenized-assets,
3 on heatmaps, 2 on watchlists** — every one from this file.

Second half of the same bug: `.app.pro-glass.pro-depth-clear` / `.pro-depth-deep` are
the same specificity as `.app.pro-glass.pro-bright` and land LATER in the file, so
Clear/Deep dragged the black values back in over the bright ones — header, sidebar,
band, table and every design-system token.

**Fix — no rule in this file names a colour any more.** Two ink tokens plus a set of
alphas:

```
--pro-ink / --pro-ink-lift   the tint every plane is mixed from   (bright: 255,255,255)
--pro-edge                   hairlines                            (bright: 15,23,42)
--pro-a-veil / -veil2        mood bands, tab strips, command bars
--pro-a-card / -card2        content cards and panels
--pro-a-plane / -plane2      dense data (tables, treemaps, sticky headers)
--pro-a-chip, -edge, -chrome, -rail, -void/-base/-surface/-elev/-overlay/-glass
```

Every surface is `rgba(var(--pro-ink), var(--pro-a-…))`. `.pro-bright` swaps the ink;
Depth and the Data-panels control only move ALPHAS, so the two axes compose instead of
fighting, and **any surface added to this file in future is bright-correct by
construction**.

**Verified** (dev :5180, playwright, scripts kept in the session scratchpad):
- A 9-config × 7-page **surface matrix** captured before and after: **0 luminance flips
  in any dark config** (the dark look is intact; max rgb drift 4/255 from collapsing six
  near-identical near-blacks onto one ink), **41 dark→light flips** in bright/paper —
  exactly the surfaces listed above.
- A **bright sweep** over 28 routed pages + their in-page tabs, then 16 deep subpages,
  then 390px mobile: **zero remaining dark planes**. The handful still flagged are
  correct by design — gradient TEXT (`background-clip:text` page titles), day-mode
  primary buttons and progress fills, image-protection scrims (`sn-hero__gradient`,
  media-center thumbs), the liquidation heatmap's deliberately-dark canvas card
  (`.liqp.day-mode` keeps it dark on purpose — it now gets the light media frame that
  paper already had), and gm-dashboard's own cinematic scene.
- Screenshots on Frost, Cloud White (bright photo), Pure White (solid), Graphite (dark
  regression), Paper, and 390px mobile.

🪤 **Removing a `.pro-bright` chrome rule regressed the header.** Once `.header` was
token-driven the bright override looked redundant — but a bright theme also turns on
`.app-day-mode`, and `header.css`'s `.app.app-day-mode .header` matches at the SAME
weight and lands later in the cascade. Dropping the rule took the header from 0.55
translucent frost to a 0.98 slab. The rule is back for specificity only; its values
still come from the tokens.

🪤 A probe that does `document.querySelector('.gtour')?.remove()` to dismiss the tour
throws `Failed to execute 'removeChild' on 'Node'` and blanks the app behind the error
boundary — which looks exactly like a real crash in a screenshot. Click "Maybe later";
never rip React-owned nodes out of the DOM.

**Known and left alone:** `/token` (Trading Lite) is documented dark-only (the embedded
terminal has no light parity) yet `proForcesDay` overrides that exception, so a bright
theme puts a light shell around a dark terminal. Pre-existing, not from this pass —
product call for Sunny.

## A5. The audit tooling (`scripts/theme-audit/`) — reuse this

Four scanners, each finds a different failure class. Run with the dev server up; override the target with `SPECTRE_URL`.

| Script | Finds |
|---|---|
| `audit-lib.cjs` + `ghost-scan.cjs` | **Ghost panels**: card-like containers whose effective background alpha < 0.15 with no frost in 3 ancestors → they float over a photo |
| `audit-lib.cjs` (SCAN fn) | **Dark slabs**: large opaque near-black surfaces that don't blend. Includes a tab-clicker so tab-hidden surfaces get scanned |
| `text-audit.cjs` | **Floating text**: leaf text with < 0.3 ancestor coverage, no frost, no shadow |
| `perf-audit.cjs` / `tdt-perf.cjs` | **backdrop-filter census** (count + filtered MEGAPIXELS) and real rAF frame timing per scroller |
| `clip-probe.cjs` | text-shadow node counts + row/viewport geometry |
| `ff-headed.cjs` / `chrome-trap.cjs` / `supports-test.cjs` | scrollbar diagnosis (Part B) |

**Filtered megapixels is the honest perf metric, not headless FPS** (headless can't reproduce retina GPU cost).

## A6. Wallpapers — BLOCKED, ready to fire

Sunny: *"i dont like hello kitty and the bottom ones. i need better versions and more, 4k"* — applies to **both PRO and LITE** (they share `public/lite-bg/` and the same catalog).

`scripts/theme-wallpapers/manifest.json` has **32 art-directed prompts**: Fun & pop redone (Kitty → "Comic Pop", + 4 new: Koi Pond, Jellyfish, Night Drive, Lo-fi Rain), all 10 Art styles, all 10 Crypto brands. `install.sh` converts downloads → 3840w JPEG ≤1.5MB into `public/lite-bg/`.

**Blocked on image credits:** Higgsfield balance is 0 (free plan), no `STABILITY_API_KEY`, CLI session expired. Unblock = top up / "use my free generations" / add a Stability key. ⚠️ After installing new files, **bump the `?v=` in `bgAsset()`** in `lite-backdrops.js` — `public/` is served immutable for a year.

## A7. Bonus fix found on the way (HYPE candles)

`/api/bars?symbol=HYPE` returned `no_data` on a rank-10 token. Bare tickers route ONLY to the hetzner tier, which needs **both** `HETZNER_BARS_SERVE=1` **and** `CODEX_FIRST_BARS=0` (the latter because `codexFirst` computes `!== '0'`, i.e. true by default — a documented inversion). With both set: 73 real bars, candles render. Set in the worktree `.env` only; **not on main/prod**. Also added HYPE/HYPERLIQUID brand mint to `tokenColors.js` (was falling back to generic violet).
⚠️ Separate unfixed bug found: cold-loading `/research-zone/hyperliquid` resolves a rank-6023 **clone** token (the `$DOT`/usedot-ai identity class). In-app navigation is fine.

## A8. Traps (the expensive lessons)

- **T1 — Pages read `dayMode` straight from the store.** Forcing `.app-day-mode` on the shell is NOT enough (`research-zone/index.jsx`, `home/index.jsx` read `s.dayMode`). The shell syncs the store value while a theme is active, and `proThemePrevDay` restores the user's own choice on exit — without it, leaving a theme strands the app in the forced mode.
- **T2 — Never put `glass-` in a class name.** `app-store-ready.css` glass-ifies any `[class*="glass-"]`. Hence `pro-glass`, `pts-*`.
- **T3 — Two opposite failure classes.** Dark-slab pages and ghost-panel pages need opposite fixes; one scanner cannot find both. Build both.
- **T4 — 🪤🪤 Per-panel `backdrop-filter` over a photo is the jank engine.** Measured: home went 1.19 MP of filtered area → **2.61 MP**, Traders Corner 0.17 → **2.54 MP (15×)**; retina is ~4× again in device px. `.token-list-wrap` alone was **1.02 MP blurred every frame** and it wrapped the table's inner scroller → torn/half-painted rows. **Fix: translucent fills carry the frost; blur only on small chrome.** After: 1.29 MP / 0.38 MP, frame timing == theme-off.
- **T5 — Container-level `text-shadow` cascades.** One rule on `.token-list-wrap` put a shadow on **655 text nodes** that repaint every inner-scroll frame. Use a denser plane instead; shadows only on genuinely floating labels.
- **T6 — Empty spans shrink-wrap.** CSS-fill swatch thumbs collapsed to 0-width slivers where photo `<img>` thumbs survived (intrinsic size). Needs `width:100%` + `align-items:stretch`.
- **T7 — Overlays must stay near-opaque.** Translucent surface tokens can thin modals/menus. `--bg-overlay` has a raised floor under glass.
- **T8 — Monarch has no day-mode parity.** Under Paper it deliberately keeps DARK frost panels, or its white text would be invisible.

## A9. Open decisions (Sunny's calls, nothing blocked on code)

1. **Entry point:** floating fab (current) vs a header entry beside day/night vs a full Themes page like LITE.
2. **Does it ship at all**, and to whom (everyone / beta / founder-only)?
3. **Monarch day-mode parity** so Paper can go properly light there.
4. **Mobile fab** slightly clips the watchlist "Add" tile corner — moot if the entry moves to the header.
5. **i18n** — studio strings are English-only.
6. `/newsroom` and `/facts` are standalone pages **outside** the themed shell — they get no theming by construction.

---

# PART B — SCROLLBARS

## B0. ⚠️ CORRECTION 2026-08-02 — B1 below diagnosed the WRONG CAUSE. Read this first.

Re-measured headed in BOTH engines on the main tree. The founder still reported
"ugly bars on Firefox, and in Chrome the bars are there but weird animation".
The cause is **ours, and it is a Chrome problem, not a Firefox one**:

**Styling `::-webkit-scrollbar` at all opts a scroller OUT of macOS overlay
scrollbars and into a classic one that permanently reserves layout space.**
Control test, same headed Chrome, one page, three states:

```
unstyled (native overlay)        gutter =  0 px
after ::-webkit-scrollbar rule   gutter = 14 px
after adding a resting thumb     gutter = 14 px
```

So `index.css`'s own comment — *"macOS-overlay feel … overlay scrollbars take no
layout space, nothing looks missing"* — is **false in Chrome**, and the entire
hide-at-rest design rests on it. The welcome page reserved **four permanent 14px
channels** (`body`, `.page-layout`, `nav.navigation-sidebar-nav`, `.tdt`), each
EMPTY at rest (thumb is `background: transparent`), each snapping a pill in on
scroll and out 900 ms later (`HIDE_MS`). Scrollbar pseudo-elements do not
animate, so it is a hard pop — that is the "weird animation". Aggravators: the
`:hover`/`:active` rule is NOT gated on `data-scrolling`, so hovering an empty
channel pops a bright pill; and it flips `border-width` 3px→1px which, with
`background-clip: padding-box`, jumps the pill **8px → 12px wide** mid-hover.
(`6aa799d6` removed the `.tdt` one: 4 → 3.)

**Firefox: B1's premise did not hold.** `AppleShowScrollBars` is **unset
(Automatic)** and only a trackpad is attached, so Firefox reserved **0 px** — a
true overlay. The resting thumb B1 added now paints a bar the platform would
otherwise hide. And Firefox exposes only `scrollbar-width` (auto|thin|none) plus
two colours — no radius, no gradient, no inset ring, no padding-box inset — so
`thin` renders a **square-cornered grey line flush to the edge**. It cannot
become the Chrome pill; at `.16` it is invisible on `#09090b`, at `.34` it is a
plain grey line. That is the "ugly bar".

Also corrected: main has **ZERO** `scrollbar-color` declarations outside
`index.css`. The "~40 legacy per-component rules" that justify all the
`!important` were inherited from the stale worktree and do not exist on main.

**Open decision (not yet made):** go native (drop the `::-webkit-scrollbar`
width/track rules so Chrome keeps macOS overlay scrollbars — 0px gutter,
self-fading, rounded, and both engines finally agree; the `data-scrolling`
stamper and the Firefox override both become dead code), or keep the custom pill
honestly (visible resting thumb so no channel is ever empty, delete the reveal,
kill the hover width jump, accept the 14px gutter as a deliberate choice).

🪤🪤 **`:5180` had TWO dev servers bound at once** — `spectre-app-risk-wt` and
the main tree, one on IPv4 and one on IPv6 — so `curl` and Playwright silently
measured DIFFERENT TREES in the same session. Two probe runs were wasted on the
stale one. Always start your own server on a free port with `--strictPort` and
point every probe at `127.0.0.1:<that port>` before believing a scrollbar number.

⚠️ **`--strictPort` does NOT protect you** (learned again 2026-08-02, on a
`mobile-token-list` grid fix). A `vite preview` was already on `127.0.0.1:5197`;
a new `vite --port 5197 --strictPort` bound `*:5197` and reported "ready" —
Node sets `SO_REUSEADDR`, so a wildcard bind and a loopback bind coexist, and
connections to `127.0.0.1` go to the MORE SPECIFIC listener. Every probe read
`vite preview`'s stale `dist/` build (hashed `/assets/*.css`) while the source
file on disk already had the fix. The port check must be
`lsof -nP -iTCP:<port> -sTCP:LISTEN` BEFORE starting and again AFTER — exactly
one row — and if the served HTML references `/assets/index-<hash>.js` instead of
`/src/main.jsx`, you are on a preview build, not the dev server.

## B1. Shipped to main — ⚠️ superseded by B0, kept for the record

**`71579159` — "fix(scrollbars): Firefox needs a resting thumb, not a transparent one"** (one file: `apps/research/src/index.css`). This is the ONLY thing from this work that is on main. No theme code shipped.

**The bug:** main's "Glass Scrollbars" system hides the thumb at rest (`scrollbar-color: transparent transparent`) and reveals it via a `data-scrolling` attribute stamped by `src/lib/glass-scrollbars.js`. That's correct for the webkit path because overlay scrollbars take no layout space — nothing looks missing. **Firefox with macOS "Always show scrollbars" ON has a PERMANENT gutter**, so a transparent resting thumb reads as an empty channel or falls back to platform grey. That is the "ugly, fixed, undesigned" bar founders kept screenshotting.

**The fix**, inside main's existing `@supports not selector(::-webkit-scrollbar)` guard so Chromium is untouched:
- real resting thumb `rgba(245,245,247,.16)` → `.34` while scrolling
- dark-on-light counterparts for `.app.app-day-mode` and `.lite-root--paper/--daylight`
- `!important`, because ~40 legacy per-component `scrollbar-color` declarations are class selectors and beat the universal rule — that mismatch is what made the bars look like three unrelated widgets

## B2. Traps

- **🪤🪤 B-T1 — HEADLESS BROWSERS CANNOT SEE SCROLLBARS.** Headless Chromium *and* headless Firefox force overlay scrollbars; headless Firefox even reports `scrollbar-width: none` for every element (an artifact — it lies). Every "verified" reading from headless was worthless. **Use `firefox.launch({ headless: false })`** — `scripts/theme-audit/ff-headed.cjs`.
- **🪤 B-T2 — Chrome 121+: setting `scrollbar-width` or `scrollbar-color` on an element DISABLES all `::-webkit-scrollbar` styling for it.** So the Firefox properties MUST stay inside the `@supports` guard. My first attempt put `scrollbar-width: thin` on `*` unguarded — it would have killed the glass pills app-wide in Chrome to fix a Firefox bug. Reverted (`0de828f3`); main's file warns about this inline.
- **🪤 B-T3 — `@supports not selector(::-webkit-scrollbar)` is the correct guard.** Empirically: `CSS.supports('selector(::-webkit-scrollbar)')` is **false in Firefox, true in Chromium** (`supports-test.cjs`).
- **🪤 B-T4 — "Lite looks good" was a false comparison.** LITE has NO scrollbars (`scrollbar-width: none` on its scrollers). It isn't a working reference.
- **🪤 B-T5 — "Scrolling jumps a full block" is a NESTED SCROLLER, not an animation.** Don't chase `scroll-behavior`. See B3.

## B3. Nested scrollers — ✅ NOW ON MAIN (`6aa799d6`, 2026-08-02)

`480369e6` — the Top Coins table (`.tdt`) had `max-height:700px; overflow-y:auto` + a promoted layer, making it a scroll container **inside** the scrolling page. One property produced three separate complaints:
- a second scrollbar stacked beside the page's (with the sidebar = the "triple scrolls")
- **wheel latching** — pointer over the table scrolls the table, the page does nothing, then lurches a whole block ("full block down/up")
- a permanently clipped last row (700px ÷ 64px rows = 10.94)

Fixed by letting the table flow with the page (the CMC/CoinGecko model). Measured: page scrollers 3 → 2. **Landed on main independently of themes as `6aa799d6` (2026-08-02)** — re-verified headed on a dedicated `:5199`: `.tdt` no longer reserves a gutter and no longer scrolls, Chrome 4 → 3 channels. Revert = restore two properties, noted inline in `welcome-page.css`.

## B4. Open

1. **Violet option.** Sunny asked for a violet/glass thumb; I shipped warm-white to match the Chrome pills (a browser-specific hue would make the two engines disagree). ⚠️ `design-system.md` §K bans purple as UI chrome (`--violet` is EUPHORIA-state only). One-line swap if he wants it.
2. **The ~40 legacy per-component `scrollbar-color` declarations** could be deleted now that the guard handles Firefox — the `!important` neutralises them, but they're dead weight and a future footgun.
3. **Port `.tdt` fix to main** (B3) if Sunny wants it.

---

# PART C — STATE

| Thing | Where |
|---|---|
| Firefox resting thumb | **on main**, `71579159` — ⚠️ diagnosed the wrong cause, see B0 |
| `.tdt` nested-scroller fix | **on main**, `6aa799d6` (2026-08-02) — Chrome 4 → 3 channels |
| HYPE brand colour | **on main**, `47c2b401` (2026-08-02) |
| This handoff + `scripts/theme-audit/` | **on main** (2026-08-02) |
| Theme Studio + wallpaper pipeline | branch `claude/pro-themes-test`, head `c9ca9506` — NOT on main, waits on A9 |
| The real scrollbar fix | **NOT WRITTEN** — direction undecided, see B0 |

⚠️ The branch also carries `24704565` ("insights: stop listing the calendar agent's JSON payloads as articles") — that is **Sunny's own earlier work** that was sitting unmerged on `sunny`; it rode along as the branch base.

**If merging the branch:** it's the Theme Studio, so it puts a floating Themes button on every page for every user — it waits on A9. The standalone base-app wins (`.tdt`, HYPE colour, this doc + tooling) have already been split out and landed on main, so the branch is now Studio + wallpapers only.

⚠️ **The branch is 19 commits behind main and has NOT seen the new Pro-mobile Top Coins or the reworked watchlists.** Before claiming Glass/Paper hold up there, merge `origin/main` into the branch and re-run `ghost-scan.cjs` (panels that vanish over a photo) + `text-audit.cjs` (floating text) over those two surfaces specifically — they are new dark-slab/ghost-panel candidates that no audit round has ever covered.
