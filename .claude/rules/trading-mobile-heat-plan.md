---
paths:
  - "apps/trading/src/**"
---

# Trading app - mobile lag + phone heating (audit + fixes)

**Created:** 2026-07-30
**Owner:** Evgeniy
**Trigger:** "на мобильном устройстве в браузере возникают лаги, греется телефон"
**Status:** Root cause found + 2 fixes SHIPPED to working tree (NOT committed, NOT deployed)
**Companion:** `performance-smoothness-plan.md` (the research-app twin of this bug class)

---

## A. Method

Live measurement on prod `trade.spectreai.io` in a 440px Chrome window, so the REAL
mobile tree mounts (`MobileHomeShell` / `MobileTokenPage`), not the desktop one.

🪤 Measurements are only valid with `document.hidden === false`. On macOS an
**occluded** (not just minimized) Chrome window reports `visibilityState: 'hidden'`
and Chrome freezes rAF + animations - every number comes back a lie. Raise the
window first: `osascript` → `set minimized of window i to false` + `set index to 1`
+ System Events `AXRaise`. Note Chrome's AppleScript property is **`minimized`**,
not `miniaturized`, and mutating `index of window i` mid-loop invalidates the
enumeration (`Can't get tab N of window M`) - find first, act after.

## B. The finding: it is GPU, not JavaScript

Main thread is genuinely clean. Measured per screen (2.5s scroll probe each):

| screen | FPS | long tasks | paint-driven infinite anims | DOM |
|---|---|---|---|---|
| Discover (screener) | 120 | 0 | 0 | 884 |
| Search | 120 | 0 | 0 | 1193 |
| Watchlist | 120 | 0 | 0 | 1193 |
| Menu | 120 | 0 | 0 | 1278 |
| Token page (chart+txns, 10s idle) | 120 | 0 | **1** (`sagent-fab`) | 1722 |

Polling is well guarded everywhere (`document.hidden` + `isAppActive()`), the price
websocket throttles leading+trailing, `MobileTokenRow` is memo'd, and the mobile
screens correctly gate their data hooks on `active`. **Do not go looking for a JS
fix - there isn't one.**

### B1. Primary cause - `AuroraField` (`src/components/ui/AuroraField.css`)

Three fixed atmosphere blooms mounted app-wide at `App.jsx:1454` for every viewport
including mobile. Measured on the live mobile tree:

| bloom | rasterized size (device px) | filter |
|---|---|---|
| cool | **696 x 1127** | `blur(120px)` |
| warm | 563 x 899 | `blur(120px)` |
| ember | 301 x 438 | `blur(120px)` |

All three carry `will-change: transform, opacity` and an infinite drift animation
whose keyframes change **`scale`**. That is the defect: a scale change INVALIDATES
the rasterized blur, so `blur(120px)` was recomputed continuously, forever, on every
screen. On the home surface they were **3 of the only 4 infinite animations running**.

**The multiplier:** `backdrop-filter` surfaces cover **1.86-2.43 screens** on the
mobile home (nav bars, sheets, screen headers) and all of them sit ABOVE the aurora.
A `backdrop-filter` must re-sample its backdrop whenever the backdrop changes - and
the aurora changed it every frame. One animation → continuous re-filter of every
blurred surface on the page. **Identical mechanism to the research app's
ParticleBackground heat fix (2026-07-07); the trading app never received it.**

The code comment claiming the layer is `GPU-cheap` is the bug.

### B2. Why a desktop A/B shows nothing (and how to measure it anyway)

On an M-series Mac at 120Hz there is **zero** difference with the aurora on vs off -
120fps, no jank, in both arms, scrolling or idle. Desktop GPUs have the headroom to
hide it. Measure the MARGINAL cost by saturating the GPU first (a phone lives
saturated - weaker GPU, higher dpr):

| extra aurora-sized blur layers | aurora ON | aurora OFF | gain |
|---|---|---|---|
| 4 | 120 | 120 | 0 |
| 8 | 119.9 | 119.9 | 0 |
| 12 | **116.7** | **120** | **+3.3 fps (+2.8%)** |

Stacking 10+ such layers **froze the renderer outright, twice, on a Mac** - rAF
starves under compositor saturation. The saturation regime is real; the phone is in it.

🪤 Any probe used under saturation must resolve on a wall-clock `setTimeout`, never
on rAF alone, or the CDP call hangs for 45s instead of returning a number.

### B3. Secondary

- `sagent-fab` - the only paint-driven infinite animation on the token page: a
  4-layer `box-shadow` with a 26-42px blur, animated forever, mounted for the whole
  life of the page.
- Trades feed: **759 row nodes**, no virtualization (`MobileDataTabs` renders the
  full 3146-line desktop `DataTabs`). Measured 0 DOM churn only because SPECTRE is a
  low-activity token - re-test on a hot one.
- Home tabs never unmount by design (`visibility: hidden`), DOM grows 884 → 1278.
- TradingView Advanced (4.4MB) is the default chart on mobile - CPU burn per cold open.

## C. Shipped (working tree only - NOT committed, NOT deployed)

1. **`AuroraField.css`** - under `@media (max-width: 768px), (max-height: 540px) and
   (pointer: coarse)` (matches `MOBILE_MEDIA_QUERY` in `hooks/useIsMobile.js`) the
   blooms get `animation: none` + `will-change: auto`. Deliberately conservative:
   the blooms STAY (same colours, positions, same `blur(120px)`), they just stop
   moving, so the blur rasterizes once instead of every frame and the permanently
   promoted GPU layers are released. **Look is unchanged.**
2. **`SpectreAgentFab.css`** - dropped the `sagent-orb-alive` box-shadow animation
   (rest + listening), holding the glow at the sweep's midpoint (0.2 / 34px) so the
   orb reads the same. The `::before`/`::after` breathing rings (opacity + transform
   = compositor-only) still carry the "alive" feel. **Applies on desktop too** - the
   glow no longer pulses there; scope it to mobile if the pulse is wanted back.

**Verified** on `localhost:5181` at 440px: blooms `animationName: none`,
`willChange: auto`, still `display: block` + `blur(120px)`; home infinite animations
**4 → 1**; token-page paint animations **1 → 0**; FAB rings still animate
(`sagent-fab-breathe`). Desktop regression check at 1300px: aurora drifts exactly as
before. `npm run build:trading` clean, `[check-critical-path] OK`.

Day mode already had `body.theme-light .aurora-bloom { display: none }` and
`animation: none` on the FAB - which is why **light mode was already the cool path**,
and why "dark vs light for 10 min on the phone" is a free confirmation test.

## C2. Round 2 - wasted re-renders + API (measured on prod, fixed, verified)

Second pass, aimed at prod-readiness: API latency, first paint, and re-renders
that produce nothing. Method: a fetch interceptor + a React commit counter
hooked onto `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`, plus a
MutationObserver, all at a 440px viewport on `trade.spectreai.io`.

### Prod boot (mobile viewport, measured)
TTFB 263ms · FCP 1040ms · **LCP 2608ms** (over the 2500 "good" line) ·
**estimated TBT 327ms** with a **322ms worst long task** · 87 requests to the
app origin. Duplicate boot calls, confirmed by the interceptor:
`/api/user/profile` x2, `/api/user/watchlist` x2, `/api/alerts` x2 - and
`/api/alerts` alone took **1549ms**. Not yet fixed; see Next levers.

### The idle re-render finding
Idle on a token page: **0 network calls but 2.3 React commits/sec, and 0 DOM
mutations** - every one of those renders produced nothing. Commit timestamps
alternated 862 / 138 / 863 / 137ms, i.e. a 1-second cycle. Two sources:

1. **`useNow` (1s) -> `EnvironmentCapsule`, in the app-wide Header.** Home
   screen idle measured a flat **1.0 commit/sec (gaps 1000/1000/999/1001ms),
   0 DOM mutations**. The capsule renders `hour + minute` only - no seconds -
   so 59 of every 60 renders were identical. On phones it is worse: the
   capsule is `display: none` under 480px (Header.css), yet React kept
   rendering it every second. **CSS hiding does not stop React.**
   Fix: `useNow` ticks per MINUTE, aligned to the minute boundary.
   Verified: home idle **1.0 -> 0.00 commits/sec over 20s**, clock still right.
2. **`DataTabs` age tick (1s).** `useAdaptivePolling(tickCallback, {interval:
   1000})` re-rendered the whole 3k-line component so `formatAge` could
   refresh - but `formatAge` only changes per second while a row is under 60s
   old; past that it reads in minutes/hours/days. Measured 22 commits in 18s
   for 2 DOM mutations. Fix: the polling call moved next to `filteredTrades`
   and its cadence is now derived from the newest row - 1s only while that row
   is younger than 60s, otherwise 30s. Token-page idle **2.3 -> 1.22
   commits/sec** after the clock fix alone.

### The DOM-mutation storm: `TokenTicker` (the big one)
Attributing mutations by target found **1800 attribute writes on
`DIV.ticker-track` in 15 seconds (=120/sec)**. `TokenTicker.jsx` drove its
marquee from a rAF loop writing `style.transform` every frame; each write
dirties the ~800-node track subtree for style recalc. **Confirmed NOT caused by
this session's edits** - reproduced with the DataTabs change `git stash`ed.

This is the exact bug the research app fixed on 2026-07-08 (756 -> 197 ms/s
main thread, -74%); the trading app never received the port. Now ported:
`element.animate()` runs the transform on the compositor, so position lives in
`currentTime` and there are zero DOM writes. Rebuild-on-resize preserves
progress via a `currentTime` ratio; play/pause covers hover, hidden tab, and an
IntersectionObserver for off-screen.

**Verified on the dev build, token page:**

| | before | after |
|---|---|---|
| DOM mutations / 12-15s | **1808** (1800 on `.ticker-track`) | **6** |
| inline `style.transform` | written every frame | **none** |
| marquee speed | 50 px/s | **50 px/s exactly** (-4916 -> -5516px in 12s) |
| hover pause | works | `running -> paused -> running` |

🪤 React synthesizes `onMouseEnter` from `mouseover`/`mouseout` - dispatching a
synthetic `mouseenter` does nothing (documented trap). `mouseover` DOES work,
which is how the hover pause above was verified without real hardware.

### Also fixed
`MobileChartToolbar` + `MobileTimeframeRow` each polled the chart's DOM every
800ms with no `document.hidden` guard - both now skip while hidden.

### Verification gap (be honest)
The DataTabs age-tick fix is verified by code + build, **not end-to-end**: on
the dev server the mobile transactions list renders 0 rows, so the age labels
could not be watched live. `GET /api/token/trades` returns 200 with 5 trades in
2s via curl, so the endpoint works - the reason the list stays empty in the
browser on dev is unresolved. Re-verify on a Vercel preview, on a HIGH-ACTIVITY
token, that: fresh rows still count up per second, and a quiet tape drops to the
30s cadence. Also note mobile renders `MobileTransactions` (`.mtx-age`), NOT
DataTabs' own table (`.cell-date`) - query the right selector.

## C3. Round 3 - tracing each boot request to its render site

⚠️ **Correction to C2.** The "duplicate API calls" claim there was WRONG. The
fetch interceptor recorded the PATH but not the METHOD, so a GET followed by a
PUT to the same path read as a duplicate. Chrome's own network log
(`read_network_requests`, which reports the method) shows them as
`PUT /api/user/profile` and `PUT /api/user/watchlist`. **Always record the
method when hunting duplicate requests.**

What they actually are is worse in an interesting way: **echo writes**. Every
boot the app reads a resource from the server and immediately writes the same
bytes back.

- **Profile.** `mergeServerSettings()` writes the server's values into the
  store while `_syncEnabled` is still false, so the subscribe watcher
  early-returns and never records a baseline. `enableSync()` then flips the
  flag, the watcher runs with `_lastSnapshot === null`, and 1500ms later it
  PUTs the profile it had just fetched. Fixed with an exported
  `primeSyncBaseline()` (`useSettingsStore.js`) called before `enableSync()`
  in `useProfileSync`. A real local edit still pushes.
- **Watchlist.** The server pull calls `setWatchlistState`, which changes
  `watchlist`, which re-runs the `[watchlist]` push effect, which PUTs it back
  500ms later. Fixed with a `watchlistFromServerRef` flag set immediately
  before the merge and consumed by the push effect (`App.jsx`).

### Fetched on boot, rendered somewhere the user cannot see
- **`/api/referral/code` (500ms).** Fetched in `Header.jsx` on every load; the
  value renders in exactly one place - a row INSIDE the profile dropdown
  (`header-profile-menu-referral-code`). Now fetched the first time that menu
  is opened. (`profileOpen` had to be hoisted above the effect - it was
  declared below it.)
- **`/api/alerts` (1549ms, the slowest boot request).** `useAlerts()` is
  mounted app-wide, and its data IS legitimately consumed app-wide (the
  triggered-alert toast + the bell badge) - so the call stays, but the initial
  fetch moved off the paint path to `requestIdleCallback` (2s ceiling, 600ms
  `setTimeout` fallback for Safari).

### Flagged, NOT changed - needs a data-model decision
The watchlist merge is a union: `[...serverTokens, ...localOnly]`
(`App.jsx`). An entry this device still has in localStorage but that was
DELETED on another device is treated as "local only" and merged back in - and
then pushed to the server. That is the same class as the research app's
cross-device data-loss bug (fixed there in PR #1093 with a last-write-wins
merge). Fixing it properly needs deletion tombstones or LWW timestamps, which
is a product/data decision, not a perf edit.

## C4. Round 4 - what the numbers said NOT to do

Chased the last three open items. Two were refuted by measurement and shipped
nothing; recording them so nobody re-runs them.

### The "322ms long task" was largely a metric artifact
Attributed boot with the Long Animation Frames API (`long-animation-frame`,
which reports per-script `sourceURL` / `sourceFunctionName` - `longtask` only
ever said `window:-`). The two big boot frames on prod:

| frame | split | attribution |
|---|---|---|
| 122ms @651ms | script 118 / render 0 / layout 4 | none - entry bundle evaluation |
| 64ms @1022ms | script 63 / render 0 / layout 1 | **51ms `posthog-recorder.js`** + 6ms React |

Their `blockingDuration` was **0ms and 3ms**. The frames are long but run while
nothing is waiting on the main thread, so the TBT figure of 232-327ms is mostly
the crude `sum(duration - 50)` formula, not felt jank. PostHog is ALREADY
idle-deferred (`analytics.js` `init()`, rIC with a 4s timeout) and behaved
correctly. Token-open is fine too: TBT 38ms, and the only two long frames are
TradingView's own `charting_library` init (55ms each). On phone silicon these
scale 3-5x, but there is no single fixable culprit left.

### Rejected: `content-visibility` on transaction rows
The feed renders 49 rows (52px each, 2548px) into a 420px viewport - only ~8
visible. Textbook `content-visibility: auto` case. Injected the exact rule into
live prod and measured: **zero rows skipped**
(`checkVisibility({contentVisibilityAuto:true})` stayed true for all 49) and the
list grew **2548px -> 2973px (+17%)** because the implied
`contain: layout style paint` changes how these grid rows size. Comment left in
`MobileTransactions.css`.

Also corrected: the "759 non-virtualized rows" in C2 counted every `.mtx-*`
node, not rows. It is **49 rows / 1160 nodes**, which is 67% of the page's DOM
but not itself a measured jank source (forced layout 0ms, 120fps). Full
virtualization of a 49-row list inside a 3k-line component is not worth the risk.

### Rejected: dropping the backdrop-filter on the fixed view-nav
`.mvn` is `position: fixed`, full width, running `blur(20px) saturate(160%)`
over a background measured at **alpha 0.969** - only 3.1% shows through, so the
blur looked like pure waste on the surface phones scroll most.

Screenshot A/B on prod with the transaction feed scrolled underneath refuted it:
without the blur the row text reads straight through the bar (`$0.3534`,
`0xa7...0556`) like a rendering bug. **3% of high-contrast glyphs preserves
their STRUCTURE, and the eye catches structure far more readily than the
luminance delta implies.** Alpha arithmetic is not sufficient grounds to remove
a backdrop-filter - A/B it against high-contrast content first.

Its siblings were checked and legitimately need theirs: `MobileBottomNav` fades
from fully transparent through a gradient, `.mtx-head` sits at alpha 0.6.

## C5. Round 5 - deploy verified on prod, then the boot-request sweep

### PR #1382 verified live (merged, `ba77767d`)
Re-measured on `trade.spectreai.io` at a 440px viewport with a LOGGED-IN
session - which is what localhost could never provide:

| | before | after |
|---|---|---|
| `.aurora-bloom` | `aurora-drift-*`, `will-change: transform, opacity` | `animation: none`, `will-change: auto`, `blur(120px)` intact |
| infinite animations (home) | 4 | **1** |
| paint-driven animations | 1 | **0** |
| `/api/user/profile` | 2 (GET + echo PUT) | **1** |
| `/api/user/watchlist` | 2 (GET + echo PUT) | **1** |
| `/api/referral/code` | 1 on boot | **0** |
| `/api/alerts` | 1549ms | 574ms |
| FCP | 1040ms | **752ms** |
| DOMContentLoaded | 1200ms | **706ms** |

(FCP/DCL carry run-to-run variance; the removed requests are exact counts.)
No service worker on the trading app, so no stale-bundle trap here.

### `public/error-beacon.js` - three bugs, found by capturing a live payload
Hooked `navigator.sendBeacon` on prod and read what it actually ships:
```json
{"app":"research","url":"/","errors":[],
 "metrics":{"consoleErrors":0,"fetchFails":0,"pageLoadTime":-1785411925513}}
```
1. **`app: "research"` on the trading app.** The label was sniffed as
   `port === '5181' || hostname === 'spectre-trading.vercel.app' ? 'trading' :
   'research'` - neither matches the real prod host `trade.spectreai.io`, so
   every beacon from the host that actually carries users was filed under
   research in Developer Control. Now a constant (`'trading'`); the file is
   served only by this app.
2. **`pageLoadTime` was never once correct.** It read the deprecated
   `performance.timing` INSIDE the `load` handler, where `loadEventEnd` is
   still 0, so it shipped `0 - navigationStart`. Confirmed to the digit:
   `navigationStart` on that page was `1785411925513` and the payload carried
   `-1785411925513`. Now read from the Navigation Timing L2 entry on a
   `setTimeout(0)` after load (same page, correct value: 1198ms).
3. **Empty flushes.** `flush()` had no early return, so it POSTed a
   zero-content payload cross-origin every 60s AND on every tab hide, for the
   life of every session. That is what the "13 error reports" in the request
   log actually were - heartbeats, not errors. Guarded now.

There are THREE copies of this beacon and all three carried bugs 2 and 3:
`apps/trading/public/`, `apps/research/public/`, `packages/server/public/`.
All three fixed. Bug 1 (the label) only mattered in the trading copy - the
other two resolve to the right app in every context they are actually served
from, so their sniff was left alone to keep the diff minimal.

Nothing of value is lost by suppressing the empty flushes: the only
non-zero field they ever carried was `pageLoadTime`, and that was the
epoch-negative garbage from bug 2. Liveness is already covered by PostHog.
(The `/api/errors` receiver lives in a separate deployment that is not in this
checkout, so its consumption could not be verified directly.)

### Duplicate native-price fetch
`/api/coingecko/simple/price?ids=ethereum,solana` fired **twice, 4ms apart**
(2384ms and 2388ms; one HTTP-cache hit, one paying 502ms). Single call site -
`hooks/useWalletBalance.js` `fetchPrices()` - which had a 60s TTL cache but no
in-flight dedup, so at boot (empty cache) every concurrent caller starts its
own request. Added the `nativePricesStore.js` inflight pattern.

### Measured, needs a product decision - PostHog session replay
After boot the dominant client traffic is session recording: **`/ingest/s/`
x20, average 715ms** (plus `/ingest/i/v0/e/` x3) in ~5 minutes, on top of 8
`/ingest/*` requests during boot. The SDK is already correctly idle-deferred;
this is the replay firehose itself. Sampling it is a product call
(Sunny/Gleb) - the same call flagged for the research app on 2026-07-07.

## C6 - Round 6: the filter sheet felt slow to open AND close (working tree, NOT committed)

User report: "на моб очень лагает фильтр, долго открывается и закрывается" (mobile
token page -> Transactions -> Filters). Two independent causes, both measured:

1. **The mobile tape re-rendered on every DataTabs state change.** `showFilterSheet`
   lives in `DataTabs.jsx` (3k lines), so opening/closing it re-runs that render,
   and `MobileTransactions` + its `TradeRow` were BOTH unmemoized - every toggle
   rebuilt all N rows (each 3-4 lucide SVGs) and blocked the frame the sheet was
   supposed to mount/unmount in. The **desktop** table already carries exactly this
   fix (the `tradeRows` useMemo, whose comment names the same "~1s lag before the
   sheet dismissed"); the mobile path never got it. Fixed: `React.memo` on the
   mobile `TradeRow` + a `useMemo`'d row list, and `onMakerFilter` promoted from an
   inline arrow in DataTabs to a `useCallback` (`toggleMakerFilter`) - without that
   the row memo busts on every render and the whole thing is a no-op.
2. **~300ms double-tap-zoom delay on the trigger.** The viewport is zoomable (no
   `maximum-scale`), so every tap without `touch-action: manipulation` is held while
   the browser waits for a second tap. Only 3 files in the whole trading app had it -
   `MobileFilterSheet.css` / `MobileMakerSheet.css` / `MobileTransactions.css`, i.e.
   the sheets' OWN controls. The `.tx-filter-btn` that opens the sheet did not.
   Added to `.tab-item` / `.tabs-actions button` / `.action-icon` / `.tx-icon-btn`.

Also: `DataTabs`' desktop `tradeRows` memo built N row elements **on mobile too**,
where that table never renders - now gated on `!isMobile`.

**Measured** (dev, 440px window, SPECTRE, 49 rows, A/B by stashing the JSX):

| | before | after |
|---|---|---|
| open (click -> sheet committed) | 15.2-24.8ms, med **20.7** | 9.4-17.5ms, med **13.8** |
| close | 13.7-17.8ms, med **16.3** | 7.3-10.6ms, med **9.2** |

~35-40% less main-thread work per toggle on an M-series Mac; a phone runs this 4-6x
slower, and the row cost scales with tape length (Load more / a long SSE tape) while
the memoized path stays flat. The 300ms tap delay is on top of that and is the larger
share of the *perceived* open latency on a real phone.

Verified in-page: type filter applies (49 -> 20, all sells) + badge, row maker funnel
filters and marks active, Reset all + Apply restores 49, sheet closes, zero console
errors, `touch-action: manipulation` computed on `.tx-filter-btn`.
Build + `[check-critical-path]` green.

🪤 Synthetic `el.click()` is NOT a trusted interaction - **Event Timing records
nothing** for it, and `long-animation-frame` never fires for this work on a Mac.
What DOES work: `t0 = performance.now()` -> `click()` -> three `await Promise.resolve()`
(React 18 flushes a discrete update in a microtask) -> read the DOM to confirm the
commit landed. The boolean makes the number honest.
🪤 The MCP tab was `document.hidden` even after `AXRaise` - it was not the ACTIVE tab
in its window, so chained `setTimeout`s were throttled and the CDP call died at 45s.
Fix: AppleScript `set active tab index of w to i` + `set index of w to 1`, then
re-check `document.hidden` before trusting any timing.

## D. Next levers (not done)

0. **Prod boot:** LCP 2608ms / TBT 327ms, with a single **322ms long task**
   dominating the blocking time - find and split it. The echo writes and the
   two boot fetches above are already handled.

1. Virtualize the trades feed (759 nodes) - re-measure on a high-activity token first.
2. Trim `backdrop-filter` on the fixed mobile bars (`blur(20-24px)` over an almost
   opaque background - same trim already done in research: A1/H6/H18).
3. 84 paint-driven infinite animations exist repo-wide (`box-shadow` /
   `background-position` / `filter`); only the ones that actually render matter -
   most are loading shimmers. Scan script pattern is in the audit session.
4. `SkinLayer` adds 3 more fixed `will-change: transform` drifting layers when a skin
   is on.
