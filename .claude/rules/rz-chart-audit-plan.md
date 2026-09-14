---
paths:
  - "apps/research/src/components/trading-chart.jsx"
  - "apps/research/src/components/TradingViewAdvanced.jsx"
  - "apps/research/src/hooks/codex/**"
  - "apps/research/api/_lib/**"
  - "apps/research/src/pages/research-zone/**"
---

# Research Zone chart — audit + fix plan ("charts still wonky")

**Created:** 2026-07-27
**Owner:** Evgeniy
**Trigger:** founder screenshot of `/research-zone/spectre-ai` — Candles + **24h** selected, chart spans **Jun 22 → Jul 27 (34.5 days)**.
**Surface:** `apps/research/src/components/trading-chart.jsx` (6,322 lines, the custom canvas chart) + `src/hooks/codex/useChartData.js` + `apps/research/api/_lib/bars-router.js`.
**Status:** AUDIT COMPLETE — nothing changed yet. Every finding below is either measured or read from code; hypotheses are labelled.

---

## A. The headline: one button, five different charts

`/api/bars` is a **5-tier cascade** and only ONE tier gap-fills. The client renders whatever comes back, identically, with no indication of which tier answered:

| tier | `bars-router.js` | gap-filled? | what "24h" looks like |
|---|---|---|---|
| `binance` | :136 | no | clean 288×5m candles (majors only) |
| `hetzner` | :165 | no | raw real-trade bars only |
| `geckoterminal` | :239 | **YES** (`gapFilled:true`) | 288 bars, **94% fabricated flat** |
| `cg-ohlc` | :268 | no | raw |
| `codex` | :327 | no | raw real-trade bars only |

Measured live against the dev server for SPECTRE (`0x9cf0…dad6:1`), 2026-07-27:

```
res=  1  n= 663  span 11.0h    realBarRatio 0.017   ← 98.3% of candles are fake
res=  5  n= 988  span 82.2h    realBarRatio 0.058   ← the "24h" preset
res= 15  n=1396  span 348.8h   realBarRatio 0.137
res= 60  n=1399  span 1398h    realBarRatio 0.450
res=240  n=1400  span 5596h    realBarRatio 0.907
res=720  n=1399  span 16788h   realBarRatio 1.000
```

So on the DEFAULT Research Zone view of a thin token, **94–98% of the candles the user is reading never happened.** They are `O=H=L=C=prev close, v=0` rows the server manufactures. That is the staircase the founder is looking at, and it is why 5m/1h "look broken" while 4h/12h look fine.

**And the founder's screenshot is the OTHER failure mode of the same cascade.** Their series is not gap-filled: candles have real bodies and wicks, timestamps are 5m-aligned but the axis ticks are irregular (Jun 22 23:30 → Jun 27 15:40 → Jul 3 08:10 → …), and at the visible candle width (`minCandleWidth = 3`, `trading-chart.jsx:2212`) at most ~480 candles fit the pane. 480 bars over 34.5 days ⇒ ~5% density ⇒ **raw real-trade bars from a non-GT tier, plotted by index.** Same button, same token, a completely different chart depending on which upstream answered that minute.

---

## A2. There are TWO charts on this screen, and they disagree

`Candles` / `Line` are the in-house canvas (`trading-chart.jsx`). `TradingView` is a different component entirely (`TradingViewAdvanced.jsx`, self-hosted charting_library, its own UDF datafeed). **The persisted default is `chartType: 'tradingview'`** (`useSettingsStore.js:84`) — so most users land on TVA; the founder's screenshot is `Candles` (verified by cropping the toolbar).

What they share and what they don't:

| | Candles / Line (canvas) | TradingView (TVA) |
|---|---|---|
| bar source | `/api/bars` | `/api/tradingview/udf/history` → **same `/api/bars`** |
| fabricated bars at 5m | 94.2% flat | **94.2% flat** (measured through UDF, identical) |
| price "cleanup" | `sanitizeBars` (`trading-chart.jsx:1649`) | `clampBarOutliers` (`TradingViewAdvanced.jsx:510`) — **a second, different engine** |
| x axis | by array **index** | by **time** (TV library) |
| "24h" window | candle count (`RANGE_VISIBLE`) | TV manages its own visible range |
| timeframe control | the shared `.timeframes` row | its own interval buttons — the shared row is hidden in TV mode (`:4732`) |

So: **the data defects (§A) hit both charts. The window/axis defects (§B) are canvas-only.**

And the two cleanup engines measurably disagree. They use different windows (2 neighbours vs ±5 median), different triggers (2× vs 3×), and different actions (canvas *replaces* close/open and squeezes high/low to ±0.2%; TVA *caps* at median×2). Run both over the same live payloads:

```
token      res   bars   canvas rewrites   TV clamps   bars where they DISAGREE
WAN        5      78          5               2                5
Jimothy    60     271         1               4                3
FWA        60     161         0               1                1
PEPGEM     60     70          0               1                1
```

A user toggling **Candles ↔ TradingView on the same token at the same interval sees different candles**, because two different pieces of our code each edit the real prices differently. That alone is enough to read as "wonky" and it is independent of everything in §B.

---

## A3. PROD AND DEV SERVE DIFFERENT BAR TIERS (measured 2026-07-27)

Evgeniy: "on prod the chart looks like different data". It is different data. Same URL, same token, same `1h` preset, same newest bar (`2026-07-27T10:00Z`), same 58.3-day fetch window:

| | localhost:5180 | app.spectreai.io |
|---|---|---|
| `X-Spectre-Tier` | **geckoterminal** | **codex** |
| bars | **1399** | **894** |
| median gap between bars | **60 min** (every bucket) | **120 min** (half the buckets missing) |
| max gap | 1h | **17h** |
| `meta` | `gapFilled: true, realBarRatio 0.45` | **none** — raw, no gap-fill |
| visible 120 bars (`DEFAULT_VISIBLE_CANDLES`) | ~5 days | ~10-13 days |

That is the whole visual difference in the two screenshots, including the `T:` badge (`T: {zoomLevel*100}%`, `trading-chart.jsx:5221` — it reads `len/120`, so it differs purely because the buffers differ).

**The founder's original "24h shows a month" screenshot is prod behaviour**: prod's 5m series comes back with a **50-minute median gap**, so 288 bars is ~10 days, not 24 hours. Dev could never reproduce it because dev is served the gap-filled GT series. This is §B's count-vs-time bug being fed by a much sparser series than dev ever sees.

**Code is identical in both** — dev imports the same handler (`packages/server/index.js:8564` → `apps/research/api/_lib/handlers/bars.js`). So the divergence is environment, not code.

Two hypotheses were tested and **refuted** (recorded so nobody re-runs them):
- *"GeckoTerminal is dead on prod"* — no. Six trending degens return `codex` with **identical bar counts on both** (1/20/1/5/3/3). Those are address-degen (no cgId); Codex-first is correct there and both environments agree.
- *"the token registry isn't bundled in prod"* — no. WETH and WBTC addresses reverse-map to the `binance` tier on prod (1000 bars each), so the registry is present and working.

### Hypotheses tested and REFUTED (do not re-run these)

| # | hypothesis | how it died |
|---|---|---|
| 1 | GeckoTerminal is dead on prod | 6 trending degens return `codex` with **identical** bar counts on dev and prod (1/20/1/5/3/3). They are `address-degen` (no cgId); Codex-first is correct there and both agree. Sample was biased — all fresh pump.fun launches GT has no data for. |
| 2 | The token registry isn't bundled in prod | It is. WETH + WBTC **addresses** reverse-map to the `binance` tier on prod (1000 bars each), and `vercel.json` bundles `packages/server/lib/token-registry.js` into `api/trade-api.js` — which is exactly what `/api/bars` rewrites to. |
| 3 | `SMART_BARS_ROUTER=1` on prod | Tried to prove it with a bare-ticker `no_data` probe (the smart path emits `X-Spectre-Budget`, the legacy path does not). **The probe is invalid**: `ctx.budget` is only set inside `tryCodex` (`bars-router.js:311`), which never runs for a bare ticker, so neither path emits the header. The test cannot discriminate; the hypothesis is unproven, not disproven. |

### Leading hypothesis: `COINGECKO_API_KEY` is missing in the Vercel research project

Both tiers that prod skipped are CoinGecko-family, and both degrade **silently**:

- `geckoterminal-bars.js:100-106` — with a key it calls `pro-api.coingecko.com/api/v3/onchain` (Lite plan: 500/min). **Without a key it falls back to the free `api.geckoterminal.com`, ~30 req/min per IP**, shared by every Vercel lambda → 429 → `console.warn('[L4-PR8-GT] /ohlcv …: HTTP 429')` → tier returns null.
- `cg-ohlc-bars.js:27-34` — `CG_BASE` is hardcoded to `pro-api` and always sends `x-cg-pro-api-key`. An empty key means a 401 on every call. **No free fallback at all.**
- → both empty → the cascade lands on Codex → raw, sparse, no gap-fill → the founder's chart.

Locally `COINGECKO_API_KEY` **is** set (27 chars), which is why dev gets the dense GT-pro series.

⚠️ The obvious counter-check ("but `/api/coingecko/*` works on prod") **does not hold**: `cg-proxy.js:31-34` falls back to the free public CoinGecko host when the key is absent, so it answers 200 either way. It proves nothing about the key.

### Also worth fixing regardless of the outcome

`buildTierList`'s own doc says `env.codexFirst  CODEX_FIRST_BARS==='1'`, but the caller computes `!== '0'` (`bars.js:291`). Under the smart router `codexFirst` is therefore **always true unless someone explicitly sets `CODEX_FIRST_BARS=0`** — the opposite of the documented default and of the cost-war intent (GT is free, Codex is metered). If the smart router is ever switched on, it will silently force the metered tier first.

### How to settle it (needs Vercel access — two options, either is decisive)

1. **Logs, fastest:** open the research project's runtime logs and grep `L4-PR8-GT`. A `HTTP 429` / `HTTP 401` line names the cause outright. Silence there means GT is being skipped by routing instead, which points back at hypothesis 3.
2. **Env:** `npx vercel env ls` (the CLI isn't installed globally; `npx` needs `vercel login` + `vercel link` first) or just read the vars in the Vercel dashboard → check `COINGECKO_API_KEY`, then `SMART_BARS_ROUTER`, `CODEX_FIRST_BARS`, `L4_PR8_DISABLE_GECKOTERMINAL`.

Re-verify after any change with `X-Spectre-Tier` on `/api/bars` for SPECTRE — it must read `geckoterminal`, and `meta.realBarRatio` must be present.

---

## B. Root cause (structural) — canvas path only

**The canvas plots candles by ARRAY INDEX, never by time.**

- x position: `chartLeft + (leftEmptyCandles + i) * candleWidth + …` — `trading-chart.jsx:3409`
- visible window: `visibleCount = floor(candleData.length / zoomLevel)` — `:2105`
- the "24h" preset is enforced as a **candle count**, not a time window: `RANGE_VISIBLE = { '1D': 288, '1W': 168, '1MO': 180, '1Y': 365 }`, `initialZoom = len / visibleTarget` — `:1810-1818`
- the only real time clamp, `WINDOW_CLAMP_TFS = { '24H','7D','30D','90D','1Y','YTD' }` — `:1770` — **deliberately excludes `1D` / `1W` / `1MO`**, i.e. exactly the three presets whose entire meaning is a time range.

Consequence: `288 bars === 24 hours` only if the series is perfectly dense. On a sparse series 288 bars is a week or a month, and the label still says 24h. Everything else in this document is downstream of that one decision.

The file already carries **five accumulated patches for this same class** — straggler trim, gap-fill ≤5 buckets, era-cliff rejection, zoom compensation on prepends, and the `minCandleWidth` floor (`:1595-1647`, `:1834-1853`, `:2212`). Per the debugging rule, 3+ fixes in the same place means the architecture is the bug, not the next patch.

---

## C. Confirmed defects

| # | Sev | Defect | Where | Evidence |
|---|---|---|---|---|
| 1 | **P0** | Fabricated candles rendered as real market data, with zero disclosure. `realBarRatio` is fetched but used ONLY to decide a CoinGecko-line swap — and that swap is gated on `!wantsOhlc`, while `preferOhlc` is true for both `candles` AND `tradingview`, so on the default path it never fires. | `useChartData.js:609-651`; `trading-chart.jsx:1436` | measured ratios in §A |
| 2 | **P0** | Timeframe presets are candle-count windows, not time windows → "24h" can legitimately render a month. | `trading-chart.jsx:1770, 1810-1818, 2105` | founder screenshot; code |
| 3 | **P0** | Chart shape/span is non-deterministic per request — which of the 5 tiers answers decides whether you see a gap-filled staircase or sparse month. Nothing in the UI names the source. | `bars-router.js:136-371`; `trading-chart.jsx` (no `chartSource` in render) | grep: `chartSource` used only for line-mode coercion |
| 4 | **P0** | **Two different engines silently rewrite real prices, and disagree.** Canvas `sanitizeBars` replaces any candle whose close is >2× / <0.5× the neighbour average with a fabricated OHLC (high/low squeezed to ±0.2%); TVA `clampBarOutliers` caps at median×2 on a >3× trigger over a ±5 window. Same token, same interval, different candles per tab. ATH / S-R levels drawn on top inherit the falsified series. | `trading-chart.jsx:1649-1674`; `TradingViewAdvanced.jsx:510-548` | measured divergence, §A2 |
| 5 | **P1** | Straggler trim re-runs on every full sanitize and can drop a different prefix each time → the index space shifts under pan/zoom, and `isPrepend` (which drives zoom compensation) mis-detects → the visible span drifts on its own. | `:1608-1623`, `:1846-1853` | code |
| 6 | **P1** | Large holes stay holes. Gap-fill is capped at 5 buckets client-side, so a 3-day hole in a merged scroll-back buffer is rendered as an invisible seam between two adjacent candles. Index plotting hides it completely. | `:1625-1646` | code |
| 7 | **P2** | Indicators inherit the fake bars. Technicals defaults to 4H (90.7% real, fine) but 5M/15M/1H tabs compute Wilder RSI/ATR/EMA over 94/86/55% synthetic zero-volume candles and present them as a read. | `rz-technicals-tab.jsx:1264-1276, 1324`; `use-kline-indicators.js` | measured ratios |
| 8 | **P2** | Axis label FORMAT keys off raw `timeframe` while the active button keys off `effectiveTimeframe` — they can disagree (CG-source tokens). | `:3412` vs `:4737` | code |
| 9 | **P2** | UDF history by bare ticker is dead: `?symbol=SPECTRE&resolution=5` → `{"s":"no_data"}`; the address form returns 989 bars. Address-first routing means TVA mostly dodges it, but the TradingView *iframe* fallback resolves `CRYPTO:SPECTREUSD` and will be wrong or blank. | `/api/tradingview/udf/history`; `trading-chart.jsx:1284` | curl, both forms |
| 10 | P2 | 6,322-line component, one `draw()` with a 30-entry dep array plus a `redrawTrigger` escape hatch. Every fix here is high-risk by construction. | `trading-chart.jsx:3766` | code |

**Not a defect (measured):** load speed. `rz:price-painted` 866ms, `rz:candles-painted` **1,525ms** on a warm dev cache; cold GT window ≈ 3s. Speed is not what the founder is seeing.

**Unverified — do not chase from a Chrome-MCP tab:** on the default `tradingview` chart type the TVA widget rendered blank in my session. The MCP tab reports `document.hidden`, rAF is frozen, the widget never inits and `tvNoData` fires — this is the documented measurement artifact (`performance-smoothness-plan.md`, 2026-07-23). Needs one pass on a real visible window before it is called a bug.

---

## D. Fix plan

### Phase 1 — Stop lying (small, ship first, no architecture change)

1. **Honesty band on the chart.** When `meta.realBarRatio < 0.6`, show a persistent chip: `12 real trades in 288 candles · 5m` with a one-click "switch to 4H" (the first resolution where this token is ≥90% real). Requires threading `serverMeta` out of `useChartData` — today it is consumed and dropped.
2. **Auto-pick an honest default resolution.** The "24h" preset on a token whose 5m series is 5.8% real should open at a resolution that is actually populated. Probe `realBarRatio` on the first response and, if <0.3, step the preset up (5m→15m→1h→4h) once, non-persisted, and say so in the chip. Never silently — the label must match what is drawn.
3. **Do not draw synthetic candles as candles.** Server already marks them (`v===0 && o===h===l===c`); render them as a thin flat tick in a muted colour, not as a body. The staircase then reads as "no trades", which is the truth.
4. **One outlier policy, both charts (defect 4).** Today `sanitizeBars` and `clampBarOutliers` are two engines with different windows, thresholds and actions, which is why the two tabs render different candles. Extract ONE shared `filterOutliers()` (a third copy already exists at `chart/adapters/codexAdapter.filterOutliers`, per the TVA comment) and make it **non-destructive**: keep the real OHLC, flag the bar, let the renderer decide. Falsifying prices to make a chart look tidy is not acceptable on a finance surface, and doing it twice differently is worse than not doing it at all.

Phases 1 and 4 apply to **both** chart paths. Phases 2 and 3 are canvas-only — TVA already plots by time and manages its own visible range, so it needs nothing there.

### Phase 2 — Make the timeframe mean time (the actual fix for the founder's screenshot)

5. **Clamp `1D`/`1W`/`1MO` by their LABELLED range.** They are range presets by their own definition (`:1297-1303`); excluding them from the only time clamp is an outright inconsistency.
   ⚠️ **Correction to the first draft of this plan:** adding them to `WINDOW_CLAMP_TFS` as-is is NOT enough, because that clamp uses `timeframeToPeriod`, which for these three is the **4× fetch buffer**, not the label:

   | key | label | `timeframeToPeriod` | clamping by period gives |
   |---|---|---|---|
   | `1D` | 24h | 96h | 4 days under a "24h" button |
   | `1W` | 7d | 720h | 30 days under a "1W" button |
   | `1MO` | 30d | 2880h | 120 days under a "1M" button |

   (The 6 CG presets already in the map have `period === label`, which is why the clamp works there.) So the change is: add a `RANGE_LABEL_HOURS = { '1D': 24, '1W': 168, '1MO': 720 }` map and clamp from it, keeping the existing `windowed.length >= 2` guard so a freshly-launched or dead token is never blanked.
6. **Replace count-based windowing with a time-based window.** `visibleCount = len/zoom` becomes "the slice whose `date` falls inside `[now - rangeMs, now]`", with zoom scaling the range in ms, not the index count. This is the real fix; step 5 is the cheap stopgap that ships today.
7. **Then delete the patches step 6 makes obsolete:** zoom compensation on prepends, the straggler trim, and the era-cliff rejection all exist purely to defend index-space from irregular time. Do not delete them before 6 lands.

### Phase 3 — Time-proportional x-axis (the structural change)

8. **Plot x from timestamp, not index.** `x = chartLeft + (t - tStart) / (tEnd - tStart) * chartWidth`. Holes become visible holes, axis ticks land on round times, gap-fill stops being needed at all, and defects 2/5/6/8 die together. Own PR, browser-verified against BTC (dense), SPECTRE (sparse), and a stock (session gaps — nights/weekends currently have zero handling anywhere in the stack, see `stocks-ta-sentiment-plan.md` §A.3).
9. Only after 8: revisit whether server-side gap-fill should exist at all. With a time axis it is pure fabrication with no upside.

### Phase 4 — Downstream

10. Gate the Technicals tab on `realBarRatio` — under ~0.6 the panel should say "not enough real trades at this resolution" instead of printing an RSI. Same honesty rule the panel already applies to warm-up nulls.
11. Fix UDF bare-ticker resolution (defect 9) or make the iframe fallback refuse unknown symbols instead of charting the wrong asset.

---

## D2. Regression check — measured, not assumed (2026-07-27)

The question that matters: does the Phase-2 clamp change what users see TODAY on working charts? Simulated the exact current window rule (`visible = RANGE_VISIBLE` newest bars) against the clamped rule, on live `/api/bars` payloads:

```
BTC (binance, dense)          1D   BEFORE 23.9h   AFTER 23.9h    ← no-op
                              1W   BEFORE 167h    AFTER 167h     ← no-op
                              1MO  BEFORE 716h    AFTER 716h     ← no-op
SPECTRE (GT, gap-filled)      1D   BEFORE 23.9h   AFTER 23.8h    ← no-op
                              1W   BEFORE 167h    AFTER 167h     ← no-op
                              1MO  BEFORE 716h    AFTER 716h     ← no-op
SPECTRE (raw/sparse tier)     1D   BEFORE 78.1h   AFTER 19.8h    ← THE BUG, fixed
                              1W   BEFORE 395h    AFTER 167h     ← fixed
                              1MO  BEFORE 836h    AFTER 716h     ← fixed
```

**The clamp is a no-op on every dense series and only bites where the label already lies.** That is the whole risk profile of Phase 2. (Founder's 34.5-day view is the same 1D row, amplified: their buffer had been grown by the background extender to several thousand bars, `maxBufferFor('5') = 6000`, `useChartData.js:136`.)

Two more risks, both checked in code:

- **Scroll-back does not break.** The clamp fires only on `isPendingChange || isInitialLoad` (`:1771`) and both flags are cleared in the swap branch, so the next update restores the full buffer and pan-left still reaches everything the extender loaded. This is the exact regression that was hit and fixed on 2026-07-03 ("still can't move left past 2023", comment at `:1759-1768`), and the 6 CG presets have been running through this same clamp in production ever since. After the clamp, `isPrepend` sees 288 → 989 bars and scales zoom by 3.43, so the visible window holds still while history merges back in.
- **Young / dead tokens are already guarded.** `if (windowed.length >= 2)` (`:1774`) — a token with 3 hours of history shows 3 hours, and a token whose last trade was a week ago keeps its full series instead of rendering blank.

### Blast radius

| surface | uses | affected by |
|---|---|---|
| `/research-zone` (pro + lite) | `trading-chart.jsx` | Phase 1, 2, 3 |
| `/` home chart panel | `trading-chart.jsx` (`chart-panel.jsx:14`) | Phase 1, 2, 3 |
| `/traders-corner` | `trading-chart.jsx` (`index.jsx:17`) | Phase 1, 2, 3 |
| `/heatmaps` floating window | `trading-chart.jsx` (`FloatingChartWindow.jsx:20`) | Phase 1, 2, 3 |
| 9 `TradingViewAdvanced` surfaces (embed-chart, search-engine, lite, monarch, …) | own UDF datafeed, own windows | **not touched** |
| trading app `TradingChart.jsx` | its own copy of the stack | **not touched** |

`chartTimeframe` is a single **global persisted setting** (`useSettingsStore.js:83`), so all four canvas surfaces move together — that is existing behavior, not something this plan changes, but it means the browser pass must cover all four, not just RZ.

Plumbing needed for Phase 1: `useChartData` receives `meta` from `codexApi.getBars` (`codexApi.js:608`) into a local `serverMeta` but **does not return it** (`useChartData.js:1156`). Exposing it is one state + one key on the returned object — additive, invisible to every current consumer.

Also found while mapping consumers: `src/chart/` (`SpectreChart.jsx` + engine + controls) is a complete parallel chart module. ⚠️ CORRECTED 2026-08-31: the "zero importers" reading was WRONG — `src/registry/` imports `chart/index.js`, and `pages/you` imports the registry. It is not dead, it is GATED: `/you` sits in `comingSoonPages.js`, so the code ships as a lazy chunk nobody can navigate to. Do not quarantine it as dead code.

---

## D3. Execution log

### Step 1 — opening window is a TIME window, not a candle count (SHIPPED to working tree 2026-07-27, NOT pushed)

Scope confirmed with Evgeniy: **Candles is the chart the founder means**, so this touches the canvas path only. TVA untouched.

`trading-chart.jsx` — two edits, nothing else:
- new `RANGE_LABEL_HOURS = { '1D': 24, '1W': 168, '1MO': 720 }` (what the button promises; deliberately NOT `timeframeToPeriod`, which is the 4× scroll-back buffer);
- `visibleTarget` now counts how many bars actually fall inside that window instead of using the fixed `RANGE_VISIBLE` count, with a `MIN_READABLE_CANDLES = 12` floor so a token that traded twice in a day doesn't open on two enormous candles.

**Chose the target-count approach over clamping `candleData`.** The first draft clamped the array (dropping out-of-window bars); that walls zoom-out and pan-left at the labelled window until the next poll re-merges the buffer — a real regression. Counting instead leaves the buffer fully intact, so the only behavioural delta in the whole change is the opening zoom level.

**Verified — live, in-page, on the same data:**

```
SPECTRE 24h  (sparse tier: 837 bars spanning 31.1 days in the buffer)
   BEFORE   288 visible bars = 279.2h  = 11.6 DAYS under a "24h" button   ← founder's bug, reproduced
   AFTER     35 visible bars =  19.8h                                      ← fixed
   candleData still 837 bars / 31.1 days → zoom-out + pan-left unaffected

BTC 24h      (dense, binance: 1000 bars)
   BEFORE   288 visible bars = 23.9h
   AFTER    288 visible bars = 23.9h    ← byte-identical, `identical: true`
```

Also: `npm run build:research` clean, `[check-critical-path] OK`, entry 0.32MB; zero console errors on both tokens; BTC/SPECTRE render correctly on screen.

Worth recording: the sparse (non-gap-filled) response **reproduced on its own in a normal dev session** — same URL, same token, minutes after a gap-filled one. That is the non-determinism in §A3 showing up live, and it is why this bug reads as intermittent to the founder.

**Still open on Candles** (not started): the 94% fabricated bars (§C defect 1) and the two disagreeing outlier engines (§C defect 4). Neither is touched by this step.

### Step 2 — history-loading indication on Candles (SHIPPED to working tree 2026-07-27, NOT pushed)

Founder ask: the Candles chart gives no sign that it is pulling bars, unlike TradingView.

Audit of what already existed: initial load has a full shimmer (`candleData.length === 0`), and a timeframe/source refetch has a thin top progress bar (`.chart-refetch-bar`). **`loadingMore` — the scroll-back history fetch — was never rendered at all**; it existed only as a guard in the pan/zoom logic. That is the gap.

- `.chart-refetch-bar` now also shows for `loadingMore`, so the top bar means "bars in flight" for both cases.
- New `.chart-history-loading` pill, **top-left**, matching TradingView's own placement: shimmer track + "Loading history", glass pill in the same language as `.chart-scroll-to-now`. Shimmer, not a spinner (design-system rule). Day-mode overrides included.
- First draft put the pill vertically centred at the left edge; moved to top-left after seeing it cover the candles in the screenshot.

Correctly scoped to user intent: `setLoadingMore` is set **only** by `fetchMoreHistory` (`useChartData.js:842,867`) — the silent background buffer-extender never sets it, so the indicator never fires for prefetch the user did not ask for.

**Verified:** triggered a real scroll-back on BTC (pan left until the left-edge fetch fired) with a MutationObserver watching — pill appeared, text "Loading history", `z-index: 11`, top bar fired 4×. Rendering checked at both themes: dark `rgba(16,16,20,0.78)` / `rgba(245,245,247,0.6)`, day `rgba(255,255,255,0.9)` / `#475569`. Position: 10px from the top, 6px from the left edge of `.chart-body`. Build clean, `check-critical-path OK`.

🪤 Synthetic `MouseEvent`s do NOT drive this chart's pan — it binds React `onPointerDown` (`:6001`). Dispatch real `PointerEvent`s (with `pointerId`/`buttons`, and stub `setPointerCapture`) or nothing happens and the feature looks broken when it isn't. Same family as the documented `mouseenter` trap.

### Step 3 — the 25px candle-width cap silently widens the labelled window (working tree, NOT pushed)

Steps 1-2 shipped in PR #1364 (merged 2026-07-27 12:28). Evgeniy re-checked prod and still saw a month under "24h". Two separate reasons, both measured:

**(a) The browser was running the old bundle.** Prod served `index-CumnvRvw.js`; the page was executing `index-lET9TBGY.js` out of the **PWA service-worker cache** (`swControlled: true`). The zoom badge proved it independently — `T: 290%` is exactly the OLD formula (834 bars / `RANGE_VISIBLE` 288 = 2.90); the new formula gives 834/37 = **22.54**. After `unregister()` + `caches.delete()` + reload: new entry chunk, new CSS present, `T: 2254%`, window 21.3h. **This is the documented PWA trap — "I don't see it" on prod means hard-refresh first.**

**(b) Even on the new bundle, "24h" rendered 49.4h.** The fix sizes the *request* correctly, but the renderer overrides it:

```
chartWidth 1457px / 38 requested candles = 38.3px per candle
  → clamped to maxCandleWidth = 25px
  → "IMPORTANT: recalculate visible candle count" refills the pane:
    floor(1457 / 25) = 58 candles = 49.4h under a "24h" button
```

So the window was still ultimately governed by candle geometry, not time. It never fires on a dense series (288 candles over ~1450px is ~5px each, far under the cap) — only on the sparse tiers, which is exactly where the label already lied.

Fix: on the range presets only, let the candle grow to what the labelled window needs, ceiling 80px so an extreme zoom-in can't produce absurd blocks (`maxCandleWidth` is now derived from `rawCandleWidth`, so it must be computed after it). Simulated against the real render formula:

| case | requested | rendered before | rendered after |
|---|---|---|---|
| BTC 24h (dense) | 288 | 288 | **288** (no-op) |
| SPECTRE 24h (sparse) | 38 | 58 (49.4h) | **37** (≈24h) |
| 1h (not a range preset) | 120 | 119 | **119** (no-op) |
| range preset, zoomed in | 5 | 58 | 18 (zoom-in now reaches deeper) |

### Step 4 — "loading is unstable and janky on 24h" (working tree, NOT pushed)

Evgeniy: data loading for Candles at 24h feels unstable. Measured, not guessed — sampled chart state + `/api/bars` timings across repeated `1h → 24h` switches.

**Steady state is fine.** 122 samples over 2 min on a settled 24h view: window constant at 23.8h, zoom constant, 2 poll requests. Warm switches land in 0.51-0.63s.

**The instability is state-dependent, which is why it feels random.** After the switch the background extender kept merging ~1,890 bars every ~600ms, each merge a full re-sanitize + canvas redraw:

```
run 8:  1918 → 3807 → 5695 → 7598 bars in 2.4s   (4 merges, 4 redraws)
run 3:  same, and the 1h buffer had already been blown to 10,400 bars
```

Root cause: **`scrollIntentRef` is reset per TOKEN but the buffer is per (symbol|resolution|periodHours)** (`useChartData.js:415`, inside the `[symbol, fetchATH]` effect). One pan-back anywhere in the session latches it, and from then on every timeframe switch skips BOTH extender guards (`:961` billed-source gate and `:966` `SPEC_BUFFER_CHEAP` gate) and runs at full depth immediately. First switch after a page load is calm; every switch after you have scrolled once is a burst. (GeckoTerminal is deliberately not in `CHEAP_BAR_SOURCES` since 2026-07-10, so it *should* be paced like a billed source — the latch was defeating that.)

Fix: re-gate on every real switch — `if (!isRefresh) scrollIntentRef.current = false` next to the existing `isRefresh` computation in `fetchBars`. A genuine scroll-back after the switch re-arms it immediately, so deep history still loads for anyone who asks.

Verified by re-running the exact scenario (real pan-back first, to arm the flag, then 5 × `1h → 24h`):

| | before | after |
|---|---|---|
| merges per switch | 4-5 | **1** (one run: 2) |
| buffer after switch | 7,598 bars | **1,916** |
| settle time | 2.4-3.0s | **~0.55s** |

Consistent across all 5 runs. Build clean, `check-critical-path OK`.

**Smaller things measured in the same pass, NOT fixed:**
- The right edge can step BACKWARDS on a poll (observed once: newest bar 12:50 → 12:40, buffer 1922 → 1920). `applyFreshBars`' refresh merge is `olderTail.concat(freshBars)`, which drops any held bar NEWER than the fresh payload — so a momentarily stale server response retracts the live edge.
- The refetch progress bar switches off ~150ms before the new data is committed (the `chartFading` swap delay), leaving a brief dim-with-no-indicator gap.
- The buffer overshoots `maxBufferFor(resolution)` (7,598 observed at res `5`, cap 6,000) because the cap is checked before a multi-window round is chosen, not against the round's size.

### Step 5 — "history doesn't load when I drag right on 24h" = a DEAD DRAG at zoom-out (working tree, NOT pushed)

Evgeniy, with a `T: 50%` screenshot: on 24h, dragging right loads nothing. Reproduced live on `/research-zone/spectre-ai` (dev): at min zoom the drag moved the chart **not at all** — the right edge stayed pinned to the newest bar and only the left edge crept older as the background extender merged. Root cause is NOT the fetch layer (bars requests did fire); it is that **the geometry was duplicated in five places and had drifted**:

| site | candle width formula | visible count at 24h / zoom 0.5 / len 5713 |
|---|---|---|
| renderer | range-cap (≤80px) + **full-fit floor drop** | **5720** → `maxOffset = 0` |
| drag / momentum / wheel / pinch | hardcoded 25px cap, 1px floor | **1613** → `maxOffset = 4100` |

So the finger pushed `panOffset` to 4100 and the canvas re-clamped it to 0 every frame. The dead-drag failure mode the file's own header comment (`OVERSCROLL_*`, :50-57) warns about — the constants were shared, the formula was not. Two contributors:
- `isFullFitTf` (renderer) listed `['1D','1W','1MO','1Y','YTD','ALL']`, letting the candle shrink **below 1px** so the ENTIRE buffer fit the pane. `visibleCount >= candleData.length` ⇒ `baseMaxOffset = 0` AND `canExtendLeft = false` (it requires `len >= visibleCount`) ⇒ no pan, no overscroll, and the at-edge fetch trigger (`maxPossibleOffset > 0`) never armed. But `FULL_FIT_TIMEFRAMES` for the OPENING zoom is only `['YTD','ALL']` — 1D/1W/1MO/1Y fetch a ~4x buffer precisely so you can pan back into it, so they never belonged in the fit-everything list.
- Step 3's range-preset width cap landed in the renderer only, so on a sparse 24h series the drag also tracked ~1.6× faster than the finger (25px assumed vs 39px drawn).

Fix: one module-level `computeChartGeometry(len, zoom, chartWidth, timeframe)` — the ONLY place the formula exists — consumed by the renderer, drag, momentum, wheel, pinch, and the at-edge history trigger (which had a sixth formula, raw `len/zoom`, ignoring the width clamps entirely). The renderer publishes its `chartWidth`/`visibleCandleCount` into `chartDimensionsRef`, so the interaction clamps measure off the last paint instead of re-deriving from `clientWidth`. `FULL_FIT_TIMEFRAMES` narrowed to `['YTD','ALL']` and shared with the zoom init.

**Verified live (dev, same token, before/after):** at `T:50%` on 24h a drag now walks the window Jul 27→Jul 22→Jul 17 (before: right edge frozen at now). Default 24h open unchanged (Jul 26 19:00→Jul 27 15:50 ≈ 21h); BTC 24h dense unchanged (`T: 347%` = 1000/288); 1W = exactly 7 days; ALL still fits full history (Dec '23→Jul '26). Build clean, `check-critical-path OK`, zero console errors.

### Step 6 — the actual "history doesn't load": the era-cliff guard was latching the wall on a 4.5-hour hole (working tree, NOT pushed)

Step 5 unfroze the drag but Evgeniy still saw no history. Instrumented the pan trigger and `fetchMoreHistory` and the answer was one field: **`hasMoreHistory: false`** on a chart that had been open for 40 seconds. No fetch was even attempted — the chart had already decided the token's history ended at Jul 24.

Measured against the live API (SPECTRE, res 5, `/api/bars`):

```
head window   997 bars  geckoterminal  oldest Jul 24 02:50   median interval 300s
older window  907 bars  geckoterminal  newest Jul 23 22:20   (requested to = head.oldest - 1)
gap = 270 min
tolerance in applyOlderBatch = intervalMs * 50 = 250 min      → 270 > 250 → REJECT
```

`applyOlderBatch` (`useChartData.js`) discarded all 907 valid bars **and called `setHasMoreHistory(false)`** — a permanent latch. Every downstream consequence follows from that single boolean: `canExtendLeft` false ⇒ dead drag; the at-edge effect and the drag trigger both gated on `hasMoreHistory` ⇒ zero requests; the background extender's `if (!hasMoreRef.current) return` ⇒ it stops too. The `[chart-extend] +908 bars` line in the console was the tell — bars arrived, the buffer never grew.

A 4.5-hour hole in a token doing ~$10k/day is not an anomaly, it is Tuesday. The fixed 50-interval tolerance can't express that, because the right question is not "how big is the hole" but **"did this batch come from the era we asked for"**. The batch is fetched with `to = oldest - 1` and `from = to - SCROLLBACK_HOURS[res]`, so every bar it can possibly contain already lies inside the requested window; a hole inside that span is missing data, while the case the guard was written for (Sunny 2026-07-02: Binance history ends and a fallback answers with 2017 bars) lands far outside it and is still rejected. So the tolerance is now `max(intervalMs * 50, one scroll-back window)`.

**Verified live, cold load:** `[chart-extend] +907 bars` now merges (999 → 1905), `hasMoreHistory: true`, drag → `[dbg-more] called` → `[chart-more] user-fetch +950 bars oldest=2026-07-17` → the extender unlocks on scroll intent (`iter=1 n=2 +1906 bars oldest=2026-07-10`). Two drags at zoom-out walk the window from Jul 24-27 back to Jul 8-11. BTC 24h unchanged (288 requested candles, byte-identical to the pre-change baseline measured by stashing the diff). Build clean, `check-critical-path OK`, no console errors.

NOT changed: the intra-round seam check in `fetchContiguousOlderRound` still uses `iv * 50`. Same class, but it only cuts the round short — it never latches the wall, and the next round retries from the new boundary. Left alone deliberately.

🪤 Debugging this from the outside is impossible: the failure is a `false` boolean, and every symptom (frozen drag, zero network) is three layers downstream of it. Temporary `console.log` at the pan trigger + at `fetchMoreHistory`'s entry found it in one drag; guessing at the fetch layer found nothing in twenty minutes.
🪤 Observed once and NOT reproduced: BTC 24h opened on a 98-candle (~8h) window instead of 288. `visibleTarget` is computed from whatever `sanitizedBars` holds at the swap and then frozen by the prepend zoom-compensation, so a partial/coarse first payload locks in a wrong window for the session. Re-measured 3× after (and against a stashed baseline): 288 every time. Pre-existing timing flake, not from this work — but it is the same "the label lies" family and worth a targeted fix (recompute the target when the real series lands).

### Step 7 — the same wall, one layer further in: the cadence guard measured DENSITY, not resolution (PR #1368, merged to main 2026-07-27)

Steps 5-6 shipped as PR #1367 and were verified ON PROD: history went from "stalls immediately" to walking back a month. It then latched a wall at Jun 23 while `/api/bars` was still serving June and earlier. Replaying the real prod window sequence through the guards named the culprit in one run:

```
window i=0: 47 bars  buffer median  90 min  batch median 115 min  -> merged
window i=1: 41 bars  buffer median 115 min  batch median  30 min  -> REJECTED (3.8x > 3x)
```

Both are ordinary 5m codex bars — the MINIMUM interval in every batch is exactly 5 min. The contamination guard compared the batch's median interval against the current buffer's, but on a raw (non-gap-filled) tier that median measures **how often the token traded**, not what resolution the bars are, and it swings by hours between adjacent windows. Dev never showed this because dev is served the gap-filled GeckoTerminal tier where every median is exactly 300s — §A3's dev/prod tier split again.

Two fixes:
- **Anchor the guard to the resolution.** Reject a batch whose bars are closer together than one bucket of this resolution (a finer series), or whose cadence is an order of magnitude coarser than both this resolution and the current series (5m → 1H is 12x). Density swings sit far inside that.
- **A rejection is not a wall.** Both "rejected" and "exhausted" returned `0`, and the user path reads `0` as genesis and latches `hasMoreHistory=false` forever. `applyOlderBatch` now returns `{added, rejected}`; overlap-only is still the wall, a rejection is not, and the background extender steps its cursor past a rejected window instead of stopping.

**Verified on prod after deploy** (SW unregistered, caches cleared, new entry chunk confirmed): three drags at zoom-out take SPECTRE 24h from July back to **Mar 29**, straight through the old Jun 23 wall. Replay of the live window sequence merges 8 consecutive windows (Jun 23 → May 31) where the old rule stopped at the first.

🪤 Three bugs in this family in a row (era gap, dead pan clamp, cadence) all shared one shape: **a defensive check whose failure mode is "declare the data exhausted forever."** When a guard rejects, it must say so; only an empty or overlap-only response is a wall.
🪤 Prod-only by construction: every one of these needs a RAW tier to show up, and dev gets the gap-filled one. Verifying a bars-layer fix on dev alone proves nothing about prod — replay the prod window sequence in the prod page (plain `fetch` + the guard arithmetic) before believing it.

### Step 8 — "stop only when the data really ends" (PRs #1371, #1372, merged 2026-07-27)

After #1370 the chart still parked at a date and went SILENT: zero `/api/bars` on any drag, while probing the same window by hand returned 40-50 bars. The date MOVED between sessions — Jun 26, Apr 9, Jun 23, Jun 27 — with data available below every one. A moving wall is a transient, not a boundary.

Two defects, both about telling "broken" apart from "empty":
- **A failed request looked like genesis.** `codexApi.getBars` swallows every exception into `{ getBars: [] }`; `fetchMoreHistory` read the FIRST empty round as genesis and latched `hasMoreHistory=false` for the session. One timeout / rate-limit / cold serverless miss ended the token's history. Now `failed` is propagated (`getBars` → `fetchOlderWindow` → `fetchContiguousOlderRound`), `genesis` is only reported when window 0 actually SUCCEEDED and came back empty, and the user path requires TWO consecutive genuinely-empty rounds — the rule the extender already used.
- **`/api/bars` had no timeout anywhere in the stack.** `apiRequest` called `fetch` with no signal, so a hung request never settles, `inflightOlderRef` is cleared in a `finally` that never runs, and every later scroll-back awaits a dead promise — silently, with `hasMoreHistory` still true. Now `AbortSignal.timeout(25s)` on the bars action plus a 30s race per window inside the round.

**Verified on prod** (SW unregistered, new bundle, state read from the React fiber): one drag → 13 requests, buffer 500 → 1193 bars, oldest Jun 27 → May 16; three drags → 21 requests, 1744 bars, back to **Apr 20**, with `hasMoreHistory` still true and `inflightOlderRef` null (idle, ready for more).

⚠️ Honest attribution: at one sample on the #1371 build the state was already healthy (`hasMoreHistory: true`, `loadingMore: false`, `inflightOlderRef: null`) and a drag still produced nothing, so the wedged-promise theory was never *proven* — the missing timeout is a real defect worth fixing either way, but the fix that best matches the moving wall is the failed-vs-empty one. If a stall ever recurs, sample those four values FIRST (fiber hooks: bars, +1 loading, +2 loadingMore, +4 hasMoreHistory, +14 inflightOlderRef) — they separate all four possible causes in one read.

🪤 Reading prod internals with no source maps: walk `canvas.__reactFiber$…` up to the fiber whose hook chain holds the bars array, then index RELATIVE to it — the `useState` order in `useChartData` is bars, loading, loadingMore, error, hasMoreHistory, athPrice, chartSource. Booleans and refs are identifiable by position, not by name.
🪤 Sampling once after a drag is not enough — poll state every 300ms for ~15s. The whole cascade (user fetch → merge → extender unlock → 13 requests) plays out over ~8s, and a single sample taken too early reads exactly like "nothing happened".

🪤 `readPanGeometry` must be declared ABOVE the at-edge-fetch effect: a `useCallback` referenced in a dep array before its `const` runs is a render-time TDZ crash (the trap already documented in `x-bubbles-cosmos-plan.md` §D).
🪤 `chartTimeframe` is a GLOBAL persisted setting — clicking 1W while testing BTC changes the timeframe for the next token you open. Cost one confused screenshot.

**(c) `T: 50%` in the founder's screenshot is his own zoom-out, not a bug.** 0.5 is `minAllowedZoom` for `1D` (`:3990`), reachable only through the wheel/pinch handlers; at that zoom the chart deliberately shows the whole fetched buffer. A clean load was sampled for 26s and held `T: 347%` (= 1000/288) with no drift. I first suspected the wheel was hijacking page scroll — **wrong**: my probe listened on the canvas while the real handler is on the container (fires later), so it read `defaultPrevented` too early. Re-tested via `dispatchEvent`'s return value: `preventDefault` IS called and the page does not scroll.

---

### Step 9 — quote-agreement gate on the bars cascade (working tree 2026-08-24, Evgeniy; the ZIG incident)

Founder screenshot: `/research-zone/zig` drew a months-long near-flat tape at $0.0577 (vol 4)
under a $0.0577 hero while the real ZIG market is $0.0402 everywhere (CG, box, CEXes, the live
ZIG/WETH pool). Full-chain probe (resolve → TVA request → all 5 tiers → box lanes → TV's own
synthetic index) found EVERY lane healthy at measurement time — the tape matches ZIG's ~20 DEAD
Uniswap v3 dust pools (pinned $0.054-0.060, the June price), i.e. Codex's per-request pair pick
landing on a dust pool when the free tiers transiently miss. Findings that corrected this doc:
- **§A3's leading hypothesis (missing COINGECKO_API_KEY) is REFUTED** — the key exists in the
  research Vercel project (Production+Preview) and is a valid PRO key (probed 200 against both
  pro-api onchain and /ohlc). The prod=codex divergence was tier fall-through, not a dead key.
- Hetzner tier is BACKGROUND-ONLY by default (`HETZNER_BARS_SERVE` unset everywhere) — it warms
  the store but never serves; the effective prod cascade is binance → GT → cg-ohlc → codex.
- The handler backfills a missing `?cgId=` from the bundled token-registry (`_resolveAddrCgId`),
  so registry tokens run GT-first even when the client's cgId races. Non-registry CG tokens
  whose request lacks cgId still go codex-first (degen path) — that hole remains, but the gate
  below defuses its consequence.
- `tradingViewEmbedUrl` (`CRYPTO:${sym}USD` guess) in trading-chart.jsx is DEAD CODE — never
  rendered; the real fail-open (`ChartIframeEmbed`) is honest (DexScreener by address).

Shipped:
- **`handlers/bars.js`: quote-agreement gate.** Optional `?refPrice=` (the live quote). A tier
  payload whose newest close deviates >1.35x (intraday) / >2x (1D/7D) from it is REJECTED and
  the cascade falls through: GT-reject → cg-ohlc (the CEX aggregate — exactly right for
  CEX-priced tokens whose DEX pools are remnants, the ZIG shape); codex-reject → GT fallback →
  else `X-Spectre-Tier: quote-mismatch` + `failed:true` (retryable, NOT terminal no_data — the
  refPrice itself can be the stale side). No refPrice → gate inert, legacy behavior byte-identical.
  cg-ohlc is never gated (cgId-keyed aggregate, same asset by construction). src=codex (trading
  terminal) path untouched.
- **`TradingViewAdvanced.jsx`:** datafeed sends `&refPrice=` (from the existing referencePrice,
  rounded to 2 significant digits so the CDN cache key is stable across ticks) + a one-per-
  symbol/res/source `[TV] bars source=` console line — the §G "which tier served this" ask.

Verified via direct handler harness (mock req/res, real env): agree→GT serves · mismatch→GT
rejected, cg-ohlc serves · no refPrice→unchanged · degen ok→codex serves · degen mismatch→
quote-mismatch failed:true. Build + check-critical-path green.

Same-day follow-ups (also Step 9):
- **Chartless-identity latch (use-research-zone-data.js).** A transient resolve failure
  produced an address-less identity, the rz-state snapshot persisted it, and the snapshot
  re-seeded `_tokenCache` on every load — `resolveToken` short-circuited on the cache forever:
  bare-ticker bars → no_data → line-only, Candles + TV buttons disabled for that token in that
  browser (founder repro on ZIG). ONE RULE now: only a CHART-READY identity (address ||
  binancePair, `isChartReadyIdentity`) short-circuits the resolve; chartless cache entries
  (snapshot seeds, nav clicks without an address, failed resolves) become the resolve's
  starting CANDIDATE — hints paint, the chain still finds the address. Self-heals poisoned
  snapshots on next visit (verified live: hand-poisoned snapshot → reload → address restored,
  both buttons enabled).
- **Synthetic gap-fill bars stripped from the TV widget (TradingViewAdvanced.jsx).** The GT
  tier gap-fills empty buckets (o=h=l=c prev close, v=0, meta.gapFilled) — ZIG 1m measured
  **673 of 706 bars synthetic (realBarRatio 0.047), longest flat run 133 min**, rendered as
  hollow flat shelves (founder screenshot; audit defect #1). The datafeed now drops synthetic
  bars when meta.gapFilled — TV lays bars by index so quiet stretches collapse (CMC look) —
  and keeps the payload untouched when EVERY bar is synthetic so a quiet window can't blank
  into the no-data fail-open. Canvas Candles path untouched (still consumes the filled series).
- **Empty bars removed from the CANVAS Candles chart too (trading-chart.jsx).** Same class as
  the TV-widget strip, two generators: (1) the SERVER gap-fill arriving in the payload — ZIG
  24h at 5m measured **220 of 287 bars synthetic**, and a zero-range candle renders as a flat
  tick, so quiet stretches drew as long dashed shelves; dropped at the `effectiveBarsRaw`
  seam, exempting stocks (a flat zero-volume session bar is real there) and CG-line sources
  (close-only by construction — the test would wipe the series), keeping the payload as-is
  when nothing real remains so a quiet window can't blank the pane. (2) the CANVAS'S OWN
  gap-fill inside `sanitizeBars` (`MAX_GAP_FILL = 5` per hole, `synthetic:true`) — it existed
  to keep the index-based x-axis roughly time-proportional across small holes, but it IS the
  reported empty bars and would have partly undone (1); its `synthetic` flag was never read
  anywhere, so nothing downstream depended on it. Quiet stretches now collapse on both chart
  modes; only real trades are drawn. Verified: payload math (287→67 rendered) + predicate
  edge cases (all-flat window, CG-line, stock, legacy {open,high,…} key shape) + clean build.
  🪤 NOT visually confirmed — the automation tab was `document.hidden`, which freezes rAF so
  the canvas never repaints and a fiber walk finds no state; needs one look on a real window.
- **Slug URLs charted a pump.fun clone (use-research-zone-data.js).** `/research-zone/zignaly`
  (a CG-slug URL, so `sym = 'ZIGNALY'`) rendered price **$0.00000556** and routed the chart to
  a DexScreener pair. Traced: the last resolve rung searches Codex BY TICKER, but a slug is a
  CoinGecko id — Codex matched on NAME and returned four Solana clones; the first ("Zignaly
  AI", `F4Rthvcn…pump`, $0.00000556 — exact match to the screenshot) was accepted as ZIG's
  address, cached, and the whole page followed it. Surfaced by the chart-ready guard above:
  before it, a chartless cache entry short-circuited the chain, so the token stayed
  correct-but-line-only instead of reaching this rung. Two fixes: (1) the Codex rung now runs
  only for TICKER-SHAPED input (`/^[A-Z0-9]{1,6}$/`) — a slug that reaches it means the
  CG-backed resolvers failed, and a chartless identity beats a wrong token; (2) the
  `/api/token/resolve` rung, skipped on localhost since a stale "false 500s on local Vite"
  note, is re-enabled — Express serves it correctly for both tickers and slugs, and DEV was
  running with only two rungs (dev/prod parity). Verified: `/research-zone/zignaly` → symbol
  ZIG, address 0xb261…4f01, $0.0403, both chart buttons enabled; `/research-zone/zig` → same
  identity, self-hosted TV widget mounts, zero DexScreener embed.
- **CG hole-era stitch — BUILT AND ROLLED BACK same day (founder call).** Investigated the
  deep-history -35% cliff at 2022-04-25→05-25: **CoinGecko has NO data for ZIG 2022-04-26 →
  2022-05-23 in ANY endpoint** (/ohlc/range, market_chart/range, days=max; GT pool history
  doesn't reach 2022 either); Codex DOES index the era (14 real daily bars). A two-layer
  hole-fill (market_chart close-derived candles + Codex stitch in tryCgOhlc/tryGeckoTerminal,
  envelope-guarded) was implemented, verified (worst adjacent jump 1.55x→1.00x), and then
  REVERTED at the founder's request along with the quote-gate live-window-only condition from
  the same pass. If this is ever revived, the measurements above still stand; note the gate
  WITHOUT the live-window condition rejects correct GT payloads on scroll-back windows
  (their last bar is old by construction), pushing deep windows to cg-ohlc.

### Step 10 — Codex pair pin (working tree 2026-08-25, Evgeniy; the ZIG 1.5x-stitch report)

Founder screenshot: RZ TradingView tab on ZIG, hero $0.0423 (correct) but the visible
Aug 15-21 candles at **0.058-0.070** with the tape ending Aug 21 — while the legend's
last-bar readout showed today's REAL bar (C 0.042598). A stitched series: history
windows from a dust tape, live head from the real market. Investigation (API replay,
no browser):
- All three serving tiers agreed at ~0.036-0.045 at measurement time (GT / Codex /
  cg-ohlc probed directly) — the garbage was not reproducible on demand, consistent
  with a per-request pick.
- **ZIG still has a LIVE dust pool: ZIG/WETH 0.01% (`0x4b2cde9eff…`), $4.4k reserve,
  trading at $0.0614 = 1.45x the real market, last trade Aug 21 07:00** — exactly the
  screenshot's price band and tape end. Its historical closes (0.046-0.056) sit at
  1.1-1.33x the live quote, i.e. UNDER the Step 9 gate's 1.35 intraday threshold —
  history windows from this pool pass the quote-agreement gate by construction.
- Root enabler: the Codex tier queried `getTokenBars(tokenAddress:networkId)`, which
  per Codex's own schema doc "aggregates bar data for the token's pairs" — dust trades
  get blended in (or substituted, in hours only the dust pool traded), differently per
  request. That is the per-window nondeterminism the gate cannot close.

Shipped (`handlers/bars.js` + `geckoterminal-bars.js`, dev+prod via the shared handler):
- **Codex pair pin.** For CG-LISTED address tokens outside the terminal lane
  (`!isPlainTicker && reqCgId && src!=='codex'`) the Codex tier queries
  `getBars(poolAddress:networkId)` on **GT's deepest BASE-side pool** — the same pool
  the GT tier charts — aliased to `getTokenBars` so response mapping is shared, in all
  three query sites (main window, genesis head, hole refill). quoteToken omitted (pin
  guarantees base side; Codex infers). Resolution: memory (24h hit / 10min miss) → KV
  `codex:pin:*` (7d — long ON PURPOSE: the codex tier mostly runs when GT is down, so
  the pin must not depend on GT answering at that moment) → one GT /pools call.
  Fail-soft: any miss = today's token-form query. `_findTopPool` now also caches the
  pool's base-token address (from `relationships.base_token.data.id`, parsed via
  lastIndexOf('_') — net slugs contain underscores); quote-side deepest pools refuse
  the pin (a quote-side pool prices somebody else's tape).
- **KV split:** pin-eligible requests cache under `:codexp`; the terminal (src=codex)
  and degen lanes keep `:codex` — a pinned payload must never serve from/into the
  token-form cache. Degens deliberately keep `getTokenBars` (its multi-pool aggregate
  spans pool migrations — pinning would drop pre-migration history).
- Verified via direct handler harness (mock req/res, real env): GT tier disabled + CG
  key removed → cascade lands on codex → `[bars-pin]` resolves `0xb36ec83d…` (the real
  $116k pool) → 148 bars 0.0362-0.0436, last = today, live. src=codex → token-form
  untouched, no pin line. Full-env run → GT serves as before (pin never consulted).
  Build + check-critical-path green.
- **Deliberately NOT built: the seam-continuity gate** (reject a scroll-back window
  whose boundary bar gaps vs the held series). Same guard family as the Steps 5-8
  minefield — its false-positive mode (rug candles, era cliffs) latches real history
  walls, and with the pin the codex tier can no longer flip pools between windows.
  Revisit only if a stitched chart recurs WITH the pin live.

**Same-day round 2 (the March-window screenshot): CoinGecko's OWN aggregate is
dust-poisoned, and the quote gate was actively feeding it to the chart.**
After the pin shipped, the founder's next screenshot showed a giant 0.030→0.055
candle at 24 Mar '26 in deep scroll-back. Measured, three facts:
- **MEXC ZIGUSDT (the real market) traded a flat 0.0298-0.0328 across Mar 23-27.**
- **CG market_chart for zignaly in that window oscillates 0.031-0.056** — the CG
  aggregate itself mixes the dust-pool venue in; the boxed "broken candle" is the
  REAL price briefly winning inside CG's garbage. cg-ohlc served it faithfully.
- **GT DID return the correct March tape (hourly retention reaches it, last close
  0.0305) — and the quote gate REJECTED it** (0.042/0.0305 = 1.38 > 1.35): the
  Step 9 note's scroll-back false-reject, observed live. Rejected-correct-GT →
  poisoned-cg-ohlc is exactly the founder's chart.
Shipped on top of the pin:
- **`quoteGateApplies` — the gate only runs on live-edge windows** (`toSec` within
  2 intervals of now). It compares the payload's newest close to the LIVE quote,
  which is only meaningful at the live edge; historical windows from the
  deepest-pool tiers (GT, pinned Codex) serve ungated — the pool identity is the
  guarantee there. The token-form Codex aggregate keeps the gate everywhere (no
  pin = no pair guarantee). This narrowly reintroduces the reverted
  "live-window-only" idea but ONLY on the deepest-pool sites, not cascade-wide.
- **Pinned Codex runs BEFORE cg-ohlc** for pin-eligible tokens on windows the pool
  was alive for (`pool_created_at` captured free from the same GT /pools response;
  guards the §11 billed-empty-window firehose on pre-pool eras). cg-ohlc remains
  the pre-pool head source and the fallback. This is a deliberate, scoped
  exception to the "cg-ohlc before Codex" cost order — for this token class CG's
  aggregate is provably wrong, and it only pays Codex when GT missed the window.
- Verified (harness, full env): March window → **tier=geckoterminal, 94 bars,
  0.0301-0.0329 (= MEXC)**; live 7d → GT unchanged; 2021 pre-pool window → no_data
  with zero Codex spend; GT-off+CG-off → pinned codex serves 0.0300-0.0328.
- **Known residual:** degen (no-cgId) deep scroll-back with refPrice can still be
  false-rejected by the bottom token-form gate when the token moved >1.35x since —
  unchanged from Step 9 behavior; fixing it means un-gating an UNpinned aggregate,
  which re-admits the dust-blend class. Needs its own think.
- ⚠️ NOT browser-verified (по правилу сессии — без браузера): needs one visible-
  window pass on /research-zone/zig — March scroll-back draws ~0.031 flat, recent
  windows unchanged, `[TV] bars source=` names the tier. Dev server must be
  RESTARTED to pick the handler up; on prod, hard-refresh past the PWA SW.

**Same-day round 3 (the Jul-2021 screenshot): cg-ohlc candles are SNAPSHOT-derived
and their ranges don't touch.** Founder's third screenshot: 1D deep history, Jul
2021, thin dash-candles then a visible void down to the next candle. Measured: the
window is served by cg-ohlc (correctly — the pinned pool was born 2021-12-13 and
Codex has ZERO ZIG data for summer 2021 in both pair and token form; CG is the
only source for that era), the series is complete (no missing days) and the July
2021 crash is real market history — but CG's OHLC candles are snapshot-built, so
a bar's open ≠ the prior close and consecutive candle RANGES can leave a void
(Jul 13 low 0.0588 vs Jul 14 high 0.0542 — impossible on a 24/7 asset). Fix in
`cg-ohlc-bars.js`: `stitchAdjacentOpens` — for ADJACENT bars only (≤1.5 buckets),
open := prior close with high/low widened to include it; the price provably
traversed that path, so it removes a sampling artifact without adding data. Bars
across REAL holes (the ZIG-2022 missing-era class) are deliberately not bridged —
that would fabricate a giant candle over an era CG lacks. Applied to all three
lanes (daily/weekly, hourly/4h/12h, 30m). Verified: the Jun-Sep 2021 1D window now
has ZERO adjacent range-voids (was several), Jul 14 opens at Jul 13's close, the
migration-artifact filter and daily-volume stitch are unaffected.

**Round 4 — "никогда больше": the continuity pass made UNIVERSAL + tested + swept.**
1. `stitchAdjacentOpens` exported from `cg-ohlc-bars.js` and applied in
   `writeBarsPayload` (bars-router.js) to EVERY outgoing series, after
   sanitizeBars — so a sanitize-flattened glitch bar reconnects too. No-op on
   already-continuous exchange/AMM tapes; real holes (>1.5 buckets) never
   bridged; idempotent, so the cg-ohlc lane's own pre-aggregation stitch
   coexisting is safe. When a stitch has to move an open >10% it logs
   `[bars-stitch] <sym> <res>` — a big closed seam means two sources disagreed
   and deserves eyes even though the chart no longer tears.
2. **Cross-PAGE seams**: scroll-back pages are separate requests, so a
   per-payload stitch can't reach the boundary bar. The cg-ohlc lanes now fetch
   ONE extra bucket before the requested window, stitch against it, drop it —
   every page's first bar opens at the prior page's close by construction.
3. **Regression tests**: `api/_lib/__tests__/bars-continuity.test.mjs` (6 tests:
   the ZIG Jul-2021 fixture, hole preservation, AMM no-op, idempotence,
   widen-only, junk input). Run with the hole-fill twin:
   `node apps/research/api/_lib/__tests__/bars-continuity.test.mjs`.
4. **Live sweep** (direct handler, real env): ZIG/SPECTRE/PALM/BTC ×
   60/1D/7D × {live week, 153d-back hourly, 500d daily, 900d weekly} +
   the 2021 cross-page boundary = 15 probes, **zero adjacent-range voids**,
   covering all four serving tiers. The SPECTRE/PALM live probes accidentally
   also exercised the wrong-refPrice path (harness passed stale refs): the gate
   rejected GT/codex and cg-ohlc served — seamlessly, 0 voids. PALM's
   migration-artifact filter fired normally under the new lead-in window.
Known residuals, deliberately out of scope: TVA's client clampBarOutliers can in
principle re-open a seam when it clamps a >3x spike bar (rare, cosmetic); the
trading app's own bars handler (apps/trading/api/bars.js) is a separate lane and
untouched; stocks never flow through this handler (session gaps there are REAL
and must not be stitched).

### Step 11 — the "M"/MemeCore chartless-identity class (working tree 2026-08-25, Evgeniy; NOT pushed)

Founder report: `/research-zone/m` (MemeCore, rank #38, CEX-priced) — no Candles chart,
TradingView "плохой график". Full trace found THREE stacked defects, two fixed:

- **ROOT (prod): the box's `/v1/coins/memecore` ships `platforms: {}`** while
  CoinGecko itself holds the verified BSC contract (`0x22b1…31fa:56`) — the
  data-lane §15 identity gap. Every resolve rung reads platforms off the BOX
  (client `getSpectreTokenResolve`, prod `handleTokenResolve`), so the identity
  stayed ADDRESS-LESS: canvas Candles fetched bare-ticker `M` → `no_data` →
  line-coerced (= "нет свечей"); self-hosted TVA got no data → fell to the
  s.tradingview.com iframe embed charting `CRYPTO:MUSD` (TradingView's own
  synthetic index — matches the screenshot's H 1.1871 / V 973K, values no tier
  of ours serves). FIX: when the box platforms yield no contract, ask CG
  directly before giving up — in BOTH `spectreMarketApi.getSpectreTokenResolve`
  (via `/api/coingecko/coins/{id}`, works dev+prod) and the prod
  `extended-proxy handleTokenResolve` (via `cgFetch`, before the 10-min
  negative cache).
- **DEV: Express `/api/token/resolve?symbol=m` returned "DIOSDELA MUERTOS"** —
  a Monad-TESTNET clone (`0x00ba…6893:10143`, hero printed $7.6e19). The route
  had no CG-search rung: direct `/coins/m` 404s (the cgId is `memecore`), so
  every CG-listed ticker outside the registry fell to the Codex phrase search.
  FIX: added CG `/search` rung (exact-symbol, rank-ordered) + platforms pick
  extended beyond ethereum (BSC/Base/Solana/… preference list) + a $500
  liquidity floor on the Codex fallback (kills testnet dust). Verified: m →
  MemeCore BSC; zig/zignaly/btc/pepe/wlfi/spx regressions clean.
- **Client hardening (`use-research-zone-data.js resolveToken`):** a CG-BACKED
  candidate (cgId) never adopts an address from a cg-less rung answer or the
  Codex ticker search — the clone class. Chartless beats a twin; the CG
  platforms fallback finds the real contract.
- 🪤 **A WRONG-but-chart-ready snapshot identity latches forever** — the ONE
  RULE (Step 9) only lets chartless entries fall through. A dev browser that
  visited /research-zone/m before this fix holds the clone under
  `spectre-snap.v1.rz-state:M`; clear that key once. Prod snapshots were
  chartless → self-heal.
- **OPEN (needs a product call): the tape QUALITY for CEX-priced tokens with
  remnant DEX pools.** With identity fixed, Candles/TVA chart the $76k BSC
  pool via GT/codex — real-ish but wick-noisy (pool tape peaks ~$6 vs real ATH
  $4.57; pool vol $12k/day vs $4.4M real). The honest source for this class is
  cg-ohlc (the CG cross-exchange aggregate — CMC-style), but it sits BELOW GT
  in the cascade and GT answers (pool alive, quote agrees at the live edge,
  1.163 vs 1.18). A "remnant-pool" gate (pool reserve ≪ mcap → prefer cg-ohlc)
  is the same guard family as the Steps 5-8 minefield — deliberately NOT built
  without a decision. Measured inputs are in this section if revived.

### Step 12 — the exact "-50.00%" candle: THREE more clamp engines missing the #1422 rule (working tree 2026-08-25, Evgeniy; NOT pushed)

Founder screenshot: M 1h, 25 Jun '26 crash — a bar reading exactly O2.6604→C1.3302
(-50.00%) with a cliff to the next candle at 0.9. Raw GT bar for that hour:
o2.6604 h2.6604 **l0.3364 c0.6599** (the real -75% rug hour). PR #1422 fixed the
"clamp erases the rug candle" class in bars-router `sanitizeBars` + trading's
`_clampSpikes`, but THREE sibling engines never got the continuation-test rule
and still rewrote real crash bars to `neighbour-median × 0.5` (the ±N window
straddles both regimes, so the median stays pre-crash):

- **serverless `tradingview-udf.js filterOutlierBars`** (±10 window, ×0.5 floor)
  — DELETED; the handler now runs the shared `sanitizeBars` (imported from
  `../bars-router.js`) + `stitchAdjacentOpens` (mirrors writeBarsPayload).
- **Express UDF copy (`packages/server/index.js`)** — its `/udf/history` crypto
  branch self-calls `/api/bars` (already sanitized+stitched) and then
  RE-clamped the result with its own ×0.5 filter. Re-clamp + function deleted.
- **client TVA `clampBarOutliers` (TradingViewAdvanced.jsx)** and **canvas
  `sanitizeBars` step 5 (trading-chart.jsx)** — both kept their median band as
  the detector but now skip the rewrite when the series FOLLOWS the bar
  (close inside next bar's traded range, 25x tolerance; live edge = volume>0)
  — the exact #1422 discriminator, so all engines agree.

Verified: dev UDF for the crash window now serves o2.6635 l0.3637 c0.6594
chaining into the next bar, zero ×0.5 signatures; BTC 1h unchanged; bars
continuity (6) + hole-fill (14) tests pass; build + check-critical-path green.
🪤 The dev server had silently NOT restarted once (EADDRINUSE → old process
kept serving pre-fix code) — a probe "still broken after the fix" must start
with `lsof` + process start-time vs file mtime.
⚠️ Pre-existing, NOT from this work: `check-bars-parity` reports research↔trading
drift on bars-router/cg-ohlc/geckoterminal copies (committed code — #1460
landed on research only). Trading re-sync is its own decision.

### Step 13 — ONE platform map (the HYPE repro; the global fix for the chartless class) (working tree 2026-08-25, Evgeniy; NOT pushed)

`/research-zone/hype` — no Candles, no TV. Root: CG's platform slug for the
Hyperliquid chain is `hyperliquid` (address `0x0d01…4011ec`, a 32-hex HyperCore
id, Codex network 999) and NO copy of our platform map knew it — the map lived
as FIVE divergent inline copies (spectreMarketApi, RZ enrichment,
extended-proxy, Express resolve, LITE), each missing different chains. Any
token whose only CG platform is unmapped resolves ADDRESS-LESS → both charts
dead. This is why the class kept recurring token-by-token.

Global fix:
- **`cg-platforms.js` — the ONE canonical map + `contractFromPlatforms`**, two
  twins: `apps/research/api/_lib/` (server; extended-proxy + Express resolve
  import it) and `apps/research/src/lib/` (client; spectreMarketApi imports +
  re-exports, RZ enrichment uses it). 24 entries incl. hyperliquid/hyperevm
  999, sui 101, robinhood 4663, sonic 146, fantom/cronos/linea/blast/scroll/
  mantle/xdai. ⚠️ KEEP THE TWINS IN SYNC — adding a chain means BOTH files.
  LITE keeps its own richer resolver (GT-ratified, §I11/I13) — already had
  these ids.
- **GT_NETWORK_MAP** (geckoterminal-bars.js) += 999 'hyperevm', 101
  'sui-network', 146 'sonic' (slugs probe-verified).
- **UDF lane parity:** dev Express UDF now passes `cgId` through its
  /api/bars self-call (dropping it starved the cg-ohlc tier → no_data);
  serverless UDF gained the MISSING cg-ohlc tier between GT and Codex
  (mirrors the /api/bars cascade order; free CG before billed Codex).
  NOTE: RZ's own TVA fetches `/api/bars` directly — the UDF fixes cover the
  OTHER consumers (LITE, monarch, home chart panel, trading TVA).

Verified: resolve hype → `0x0d01…:999`; /api/bars + dev UDF for it →
cg-ohlc 72×1h bars (c≈80.09 = live); m/zig/btc/sui regressions clean; bars
tests 6+14 pass; build + check-critical-path green.
🪤 The stale-server trap bit AGAIN (kill → port not yet released → new process
exits EADDRINUSE → old code keeps serving). After any server restart: `lsof
-t` the listener and compare its start time to the file mtime BEFORE probing.

**Follow-up (same day): `RZ_IDENTITY_V` — the poisoned-snapshot self-heal.**
The founder's HYPE tab still showed the DexScreener embed after the fixes:
browsers that visited a token under the PRE-fix resolve hold a chart-ready
snapshot identity with a WRONG address, and chart-ready identities
SHORT-CIRCUIT resolveToken — the Step 11 trap, latching forever per browser.
Snapshot identities are now version-stamped (`v: RZ_IDENTITY_V` at the
snapPut writer); `peekRzStateSnapshot` demotes un-versioned identities to
paint hints (address/networkId/codexId/binancePair stripped, name/logo/cgId
kept), so the fixed resolve chain re-runs once and re-persists stamped. Every
poisoned browser — dev and prod — self-heals on its next visit, no manual
localStorage clearing. Bump the constant whenever the identity contract
changes again.

### Step 14 — LEO first-load "dash chart": the box close-only tape drawn as candles (working tree 2026-08-25, Evgeniy; NOT pushed)

First load of `/research-zone/leo` rendered every TV candle as a flat dash
(o=h=l=c) with real volume; a reload fixed it. Traced end-to-end: on a
chartless-identity first mount the TVA datafeed queried `/api/bars` by BARE
TICKER → empty → its SPECTRE OHLCV FALLBACK adopted the box
`/v1/prices/LEO/ohlcv` — which for long-tail rows is a daily CLOSE replicated
into all four fields (measured: 8/8 bars flat, last volume 245524 = the
screenshot's "245.524K" verbatim; data-lane §12c class). The reload used the
now-persisted chart-ready identity → `/api/bars` by address → GT tier real
candles (probe o9.2215 h9.2766 l9.0157 c9.2161 = the second screenshot's
legend, byte-identical).

Fixes:
- **Candle gate on the TVA fallback** (TradingViewAdvanced.jsx, same rule as
  LITE §I11): adopt the box tape only when some non-live-edge bar has h>l. A
  fake-flat series falls through to no-data and the chart degrades honestly
  instead of drawing dashes. WBTC-class CEX rows (the fallback's raison
  d'être) carry real ranges and keep working.
- **The race itself is closed by Steps 11/13**: resolve now returns the
  address for CG-listed tokens up front (LEO → `0x2af5…:1` immediately), so
  the bare-ticker first mount stops happening for this class.

### Step 15 — the false "Chart unavailable" flash + WHY Candles and TV disagree (2026-08-26, Evgeniy; working tree, NOT pushed)

**(a) Shipped — the flash.** Founder on USYC: the chart pane prints
"Chart unavailable / CHART DATA UNAVAILABLE FOR THIS TOKEN" during load, then
the real chart appears. Cause: RZ mounts the chart BEFORE the resolve chain has
an address, so `chartToken` falls back to `{symbol, address:null}` → the canvas
fires a BARE-TICKER `/api/bars` → no_data → `useChartData` sets the
unavailable error and `loading:false` → the error branch renders (the shimmer
branch is only reached while `effectiveLoading`). Same window latched the TV
widget's no-data fail-open onto the DexScreener embed ("Loading pair…").
Fix: opt-in `identityPending` prop (RZ lite + mobile pass
`loading.token || !chartToken`); `identityUnready = identityPending &&
!tokenAddress` nulls the useChartData symbol (no wasted bare-ticker request),
suppresses the error branch, and holds a shimmer INSTEAD of mounting
TVA/embed. Default false ⇒ home panel / traders-corner / heatmaps unchanged.
Added a `.catch` on the resolve promise: the chart now depends on
`loading.token` clearing, so a throw must never leave it true.
🪤 NOT browser-verified (token budget) — worth one look at a cold token open.

**(b) Diagnosed, NOT fixed — Candles vs TradingView show different charts.**
Founder on `/research-zone/leo-token`. It is NOT a data-source split: both
paths hit the SAME `/api/bars` and, measured, the SAME tier. The collision is
the TIMEFRAME VOCABULARY — one persisted `chartTimeframe` value read by two
maps that disagree:

| stored `timeframe` | canvas `timeframeToResolution` (trading-chart.jsx:1471) | TVA `TIMEFRAME_TO_RESOLUTION` (TradingViewAdvanced.jsx:58) |
|---|---|---|
| `'1D'` | `'5'` + 96h window — a RANGE preset meaning "24h" | `'1D'` — DAILY candles |
| `'1W'` | `'60'` + 720h — "7 days" | `'1W'` — WEEKLY candles |
| `'1MO'` | `'240'` + 2880h | (absent → falls to `'60'`) |

Measured on LEO, same button, same tier (geckoterminal):
`canvas res=5/96h → 838 bars, 815 flat, Aug 22→25` vs
`TVA res=1D → 364 bars, 17 flat, Aug '25→Aug '26`. Four days of 5-minute
candles against a year of dailies. The 97% flat count is the second half of the
report: LEO's DEX pool barely trades, so GT gap-fills almost every 5m bucket
and the canvas (correctly) drops synthetics, leaving ~23 real bars.
Secondary divergences, same class: TVA sends `refPrice` (arms the server quote
gate) and `src`, the canvas sends neither — so the two CAN land on different
tiers; and each runs its own client post-processing.
**Fix path (one shot, mechanism already shipped in LITE §I7):** map the range
presets to `{resolution, visibleRangeSec}` and pass `visibleRangeSec` to TVA
(the prop already exists, RZ just never passes it), so one button means one
window on both engines. Product-visible on every canvas↔TV switch — needs a
green light.

### Step 16 - scroll-back was paging by BUCKETS on a tape that trades in trades (working tree 2026-08-26, Evgeniy; NOT pushed)

Evgeniy: history on Candles loads slowly. Measured on prod, `/research-zone/leo-token`
5m, by driving `fetchMoreHistory` straight off the fiber: 8 pages, ~4.3s of network,
6-56 bars each (median 25), oldest moved Apr 28 -> Mar 20 = **39 days**.

**Root cause is one number.** `SCROLLBACK_HOURS['5'] = 80h = 3.33 days`. The server
(`handlers/bars.js:291,311`) classifies a request as a WIDE PROBE only when
`(to - from) > MAX_WINDOW_BARS * intervalSec`, which at 5m is `1000 * 300s =
**3.47 days**` - and ONLY a wide probe forwards `countback` to Codex. So the stride
sat **0.14 days under the line**: every scroll-back page went down the verbatim
`[from..to]` path and got back the handful of trades that happened to fall inside
3.3 days, at full round-trip price. Measured at one anchor (2026-04-28), same
latency band:

| window | bars | history |
|---|---|---|
| 80h verbatim (the stride) | **9** | **2 days** |
| wide, countback default 500 | 500 | 76 days |
| wide, countback 1000 | 1000 | 170 days |
| wide, **countback 1500** | **1500** | **283 days** |

Same at 1m (500->1500 bars = 69->245 days) and 1h (92->403 days). Latency scales
gently: 575ms -> 1273ms for 3x the bars. `countback` is an already-shipped server
param the TRADING app uses for exactly this; research had **zero** call sites.

Shipped:
- **`hooks/codex/chart-history-window.js` (new, pure, no app imports)** -
  `DEEP_PAGE_COUNTBACK=1500`, `isDeepPageEligible`, `historyWindow`,
  `eraCliffToleranceMs`. Pure so the guard arithmetic is unit-testable;
  `__tests__/chart-history-window.test.mjs` (7 tests) pins it.
- **`fetchOlderWindow(ctx, toSec, {deep})`** - a deep page asks a 3y window (the
  codexApi clamp - wide enough to trip the wide-probe test at every resolution
  without mirroring the server's per-resolution table, which would rot) plus
  `countback=1500`, and reports the `windowSec` it used.
- **`codexApi.getBars(..., opts)`** - optional `{countback}`, capped at the
  server's 1500, and part of the DEDUP KEY (a 1500-bar page and a plain window
  over the same span are different answers; sharing one in-flight promise would
  hand the pager the short one).
- **`fetchContiguousOlderRound`** forces `batchN=1` for deep pages (one page
  already covers what 20-50 strides would; fanning out re-asks for it and, on
  Codex, bills for it) and returns `windowSec`.
- **The era-cliff tolerance now follows the window actually fetched.** THIS IS THE
  DANGEROUS HALF: it was `SCROLLBACK_HOURS * 3600`, and a deep page spans up to 3
  years - LEO's ordinary ~6-day quiet stretches (max measured gap 8820 min) would
  have been read as a wrong-era cliff, discarding 1500 good bars AND latching
  `hasMoreHistory=false`. Exactly the failure mode of steps 6-8. All three
  `applyOlderBatch` call sites pass the span through (the CG line-upgrade path
  sizes it from the payload's own span).
- **Cost discipline kept:** deep only after REAL scroll intent. The speculative
  prewarm on every token open stays on the narrow stride.
- **`nearGenesis` for deep pages** = a short answer, but only when Codex served it:
  the free tiers ignore `countback` and legitimately answer ~1000 bars every time,
  so the short-answer rule would be permanently true there (measured on dev: GT
  answers a deep page with 974 bars).

Verified: build + `[check-critical-path]` green; 7 new tests + the 6 continuity and
14 hole-fill tests pass. Live on dev, LEO (GT tier): deep path fires (`n=deep`,
`user-fetch deep`), 8 pages, ~870-1000 bars each, nothing rejected, no wall latched,
history walks back monotonically Aug 19 -> Jul 5. Same anchor narrow-vs-deep on GT:
868 vs 908 bars, 3.0 vs 3.1 days - **a no-op on the dense/gap-filled tier**, which is
the correct risk profile. Live on dev, BTC (Binance tier): exactly 960 bars/round =
the narrow stride's capacity, deep correctly refused.

**Follow-up same day - M87 "битые бары" (founder screenshot) is a SEPARATE,
PRE-EXISTING bug, and step 10's revisit condition has now been met.**
Reported as still-broken bars after the deep-page work, so the first thing
checked was whether the widened era-cliff tolerance caused it. It did not:
stashing the whole change and re-running the identical scroll-back on
`/research-zone/m87` 1M reproduced it byte for byte - 9203 bars, oldest
2022-06-10, **max adjacent price jump 26x at 2023-08-07T12:00**
(2.803e-8 -> 7.301e-7), same per-year zero-volume split. The era-cliff guard
is TIME-based and that seam's time gap is 3.2 days, well inside even the
`intervalMs * 50` floor (8.3 days at 4h), so it was never going to catch it.
The deep page only made the bad era reachable in 6 rounds instead of 12.

Measured cause: **three tiers spliced into one index-plotted series**, each
self-consistent, none agreeing with the next.

| era | tier | volume | close at the boundary |
|---|---|---|---|
| 2023-08-10 -> now | geckoterminal (`gapFilled`, realBarRatio 0.861) | real | 3.533e-6 |
| 2023-08-07 (ONE bar) | codex | none | 7.301e-7 |
| 2022 and older | **cg-ohlc**, `meta.volumeAvailable:false` | none at all | 2.710e-6 |

Deep scroll-back walks past the DEX pool's genesis, the cascade falls to
CoinGecko's aggregate, and CG prices this token on a different basis. Being
close-only, that era also rendered as the flat dashed shelf under the real
candles in the screenshot - the step-14 class, arriving by a different route.

Shipped: **tier-contract seam gate** in `applyOlderBatch`
(`seamContractBroken` in chart-history-window.js, 6 more tests).
- The discriminator is the SERVER'S OWN CONTRACT (`meta.volumeAvailable ===
  false`), **not a price ratio**. A young token legitimately moves 25x between
  adjacent 4h bars - M87's own surviving seam is a real 4.8x - so a ratio gate
  truncates real history. That false-positive mode is exactly why step 10 left
  this guard unbuilt; keying on the contract sidesteps it entirely.
- It fires ONLY when close-only data arrives at a series that HAS volume. A
  chart served close-only end to end (HYPE: 48/48 zero-volume cg-ohlc bars)
  pages exactly as before - verified live, no gate hit.
- A hit returns `{rejected:true, reason:'close-only'}` and **never latches
  hasMoreHistory** (steps 7-8: only an empty or overlap-only answer may). The
  background extender stops walking on that reason - deeper probes only find
  more of the same tier - but a user drag may still retry, which self-heals if
  the richer tier was merely down.
- `meta` is now threaded fetchOlderWindow -> round -> applyOlderBatch; it was
  fetched and dropped before.

Verified live on dev, identical starting state (720 bars, oldest 2026-04-28, 1M):

| | before | after |
|---|---|---|
| rounds to exhaust | 12 | **6** |
| oldest bar | 2022-06-10 | **2023-08-07** (the real DEX genesis) |
| max adjacent jump | **26x** | **4.8x** (a real early-life move, kept) |
| 2022 bars | 1225, ALL zero-volume | **0** |
| 2023 zero-volume | 1447 / 2167 | 141 / 861 (GT gap-fill only) |

Screenshot after: clean candles with volume, no shelf, no cliff. BTC unchanged
(960 bars/round, no gate hit). HYPE unchanged.

**Verification gap CLOSED + a regression harness (same day).**

`scripts/chart-history-audit.mjs` (`npm run audit:chart-history`) replays the
scroll-back walk against a LIVE `/api/bars` and audits the series it ends up
with. It IMPORTS the shipped guards from `chart-history-window.js` - it must
never grow its own copy, or it stops testing what ships. The walk itself is a
replay (it cannot import useChartData - React), so keep it thin and keep the
decisions in the imported helpers. Not covered: the resolution-contamination
guard (only reachable through a timeframe-switch race) and the React wiring.

It fails ONLY on signatures attributable to a defect, never on volatility:
MIXED CONTRACT (a long volume-less run inside a volume-bearing tape),
JUNK PRICE (a non-finite / <=0 / <1e-15 OHLC field), IMPOSSIBLE MOVE (>1e6x
between adjacent bars), TRANSIENT WALL (the walk ended on a failed request),
NON-MONOTONIC.

**`--no-seam-gate` is the harness's own self-test** - it replays without the
shipped guard, and the m87 case MUST go red. Verified: guard off -> 9203 bars,
max jump **26x**, longest volume-less run **2532**, exit 1; guard on -> 6672
bars, 4.8x, exit 0. A detector that has never gone red is not a detector.

**The codex tier was then exercised directly** by starting a SECOND Express on
:3009 with `PORT=3009 L4_PR8_DISABLE_GECKOTERMINAL=1` (the dev server on :3001
untouched - do it this way, never restart someone's running server). On the
codex tier, which is what prod serves:

| case | result |
|---|---|
| m87 | **clean** - 6453 bars, pages `+1500 +1500 +1500 +1232 REJECTED(close-only)`, max jump 4.8x, 0.0% volume-less |
| btc | unchanged - 1000 bars/round, binance, 0% volume-less |
| leo | **RED on a new, unrelated defect** - see below |

So the deep page returns full 1500-bar pages on codex exactly as measured on
prod, and the seam gate fires there. That closes the gap this section warned
about.

**🪤 NEW FINDING, upstream: Codex serves junk closes.** FIXED in step 16b below. LEO 5m on the
codex tier returns bars whose OPEN is real and whose CLOSE is garbage, at full
volume: `2023-01-12T05:50 o=3.92250987358 c=4.10238194543e-36 v=107`, twice in
306 bars (4 across the walked series). The real range in that window is
2.489..9.098. The server's `clampOutlierBars` does not catch it - it clamps
against a neighbour median and a 36-orders-of-magnitude close is nowhere near
that band. Rendered, this is a candle wicking to zero, i.e. another "битые
бары" report waiting to happen, and on a LOG axis it destroys the scale.
The harness fails on it (JUNK PRICE + IMPOSSIBLE MOVE). Root-caused and fixed
in step 16b.

RESOLVED - the codex tier is now exercised locally via the :3009 recipe above.
After deploy, still worth one prod glance: a scroll-back page should log
`user-fetch deep +1500 bars`, and on m87 history should end at 2023-08-07 with
`[chart-seam] refused a close-only batch` in the console.

Trap: the /api/bars response key is **`bars`**, not `getBars` (the client renames it).
A probe reading `getBars` reports 0 for every window and looks exactly like no-data -
cost one wrong experiment round.

### Step 16b - the junk closes, root-caused and fixed (2026-08-26, working tree)

Measured on the codex tier, LEO 5m:

```
285: o=4.347546   h=4.347546  l=3.922510   c=3.922510
286: o=3.922510   h=3.922510  l=4.102e-36  c=4.102e-36  v=107
287: o=4.102e-36  h=3.028527  l=4.102e-36  c=3.028527   v=10
288: o=3.028527   h=3.091454  l=3.028527   c=3.091454
```

It is not a corrupted FIELD, it is one corrupted PRICE POINT: each bar's open is
the prior close and h/l are the body's extremes, so the same bad number
legitimately lands in four slots. And `4.10238194543e-36 * 1e36 =
4.10238194543` - a real LEO price for that window (range 2.49..9.10).
**1e36 = (1e18)^2, i.e. the token's decimals applied twice upstream.**
Reproduced at 5m, 60m AND 1D for the same token/era (always exactly 1e36) while
M87 and LEO's recent windows are clean - so it sits in Codex's trade records,
not in any one aggregation.

**Why clampOutlierBars could never catch it:** it only ever rewrites `h` and `l`
- it is a WICK clamp, and a corrupted close is outside its scope entirely. Not a
threshold problem. Worse, the tiny close drags `bodyMin` to ~0, which makes its
own low test unsatisfiable, so a junk close also DISABLES the wick guard on that
bar.

Shipped: `repairScaledPrices` (bars-router.js), running FIRST in
`writeBarsPayload` - before sanitizeBars, whose median band the junk poisons,
and before stitchAdjacentOpens, which would otherwise stitch the next open to a
junk close - and mirrored into the serverless UDF lane. The Express UDF
self-calls /api/bars, so it inherits it.

- Repairs only when an EXACT power of ten in the decimals-plausible range
  (10^6..10^40 = two 18-decimal applications plus slack) lands the value within
  20x of the local median. 10^300 is refused and the bar is dropped instead.
- A non-positive / non-finite field carries no magnitude to rescale from, so
  that bar is dropped, never guessed.
- After repair, **h/l are WIDENED to include o and c**. They were derived from
  the corrupted point, so a naive rescale yields `c > h`. `l <= min(o,c) <=
  max(o,c) <= h` is the DEFINITION of an OHLC bar, not a cosmetic fix - and
  widening only ever adds range, so a legitimate long wick is never narrowed.
- Every repair/drop logs `[bars-scale]`, mirroring `[bars-stitch]`.

Verified live on the codex tier - the same window now reads:

```
04:55  o=4.347546  h=4.347546  l=3.922510  c=3.922510  v=93
05:50  o=3.922510  h=4.102382  l=3.922510  c=4.102382  v=107
05:55  o=4.102382  h=4.102382  l=3.028527  c=3.028527  v=10
15:45  o=3.028527  h=3.091454  l=3.028527  c=3.091454  v=63
```

0 junk fields, 0 invalid candles, the chain continuous, volume preserved, and
the series' max adjacent jump **9.56e35x -> 1.97x**. The audit harness goes 3/3
on the codex tier (was 2/3) and stays 3/3 on GeckoTerminal, its --no-seam-gate
self-test still goes red, BTC is untouched, and 10 new tests pin the behaviour
on the real fixture. `check-bars-parity` drift is pre-existing and byte-identical
before and after (verified by stashing the change) - re-syncing the trading
copies is its own decision.

🪤 Only the Express UDF path is locally verifiable for crypto (dev serves the
inline route, prod serves the serverless handler), so the serverless UDF wiring
is covered by inspection plus the shared function's tests, not by a live probe.

## E. Verification

- `curl 'localhost:3001/api/bars?symbol=<addr>:1&resolution=5&from=&to=' | jq '.meta'` — the ratio is the ground truth for every claim above.
- Browser, **visible window only** (a Chrome-MCP tab is `document.hidden` → TV widget never inits, WebGL/rAF frozen):
  - SPECTRE 24h: axis first tick must be ≤24h old, and the honesty chip must be present.
  - BTC 24h: unchanged, 288 dense candles, no chip.
  - Switch 1M → 24h → 1M: window must snap to the label each time, no drift while the extender loads.
  - Pan left to the wall: history loads, visible SPAN stays constant (this is what zoom compensation currently approximates).
- `npm run build:research` + green `[check-critical-path]` after every step.

---

## F. Do not touch

- The `/api/bars` cost cascade order (Binance → Onchain Bridge → Hetzner → GT → Codex) — intentional cost optimization, project memory.
- The allorigins 4s timeout in `binance-bars.js:228` — looks dead locally, is the prod path; cutting it blanked prod charts once (PR #914 reverted).
- The UDF resolution-bucketed cache keys — already correct.
- `preferOhlc` — it exists because the old sparse detector made Candles mode impossible for thin tokens. Fix the disclosure, do not reinstate the silent line swap.

---

## G. Open

- Which tier served the founder's session? The screenshot proves it was NOT gap-filled, but GT answers in dev today. Log `chartSource` + `realBarRatio` into the chart's own DEV console line so the next report identifies its tier in one glance.
- Stocks: zero session/weekend handling anywhere in the bars stack. A time-based axis (Phase 3) makes this visible rather than silently wrong — plan the session-aware windowing with it.
