---
paths:
  - "apps/research/api/_lib/**"
  - "packages/server/lib/token-registry.js"
---

# CEX venue map — the chart data source for tokens the registry never knew

**Created:** 2026-08-27
**Owner:** Evgeniy
**Status:** DESIGN APPROVED — spec written, no code yet
**Companions:** `rz-chart-audit-plan.md` (the 16-step guard history this replaces the need for), `charts-system.md` (the tier inventory), `data-lane-fixes-for-alaa.md` §15 (the identity rot this routes around)

---

## A. The problem, measured

Six founder screenshots, 2026-08-26. Every one is a **top-52 token**:

| token | what we drew | what the exchange had, that hour | hero |
|---|---|---|---|
| ASTER #47 | Jul 18, ~$0.62 | `ASTERUSDT` 0.6970 | 0.6974 |
| WLFI #49 | Aug 17, ~$0.0601 | `WLFIUSDT` 0.0576 | 0.0580 |
| MORPHO #52 | era ~Sep '25 | `MORPHOUSDT` 2.4710 | 2.47 |
| GRAM #27 | 0.000686, and a 0.003↔1.5 era splice | `GRAMUSDT` 1.388 | 1.39 |
| HYPE #10 | "Loading pair… DexScreener" | Bybit 81.14 / OKX 81.158 | 80.94 |

The data existed the whole time: free, keyless, current to the hour, agreeing with our own hero price to 3-4 significant digits. We never asked for it.

**Why we never asked.** `lookupBinancePair(symbol, cgId, address)` (`apps/research/api/_lib/binance-bars.js`) is the single gate that decides whether a chart gets clean CEX klines or the DEX cascade. It resolves against `packages/server/lib/token-registry.js` — **44 entries, hand-typed, last touched 2026-07-02**, still carrying `MATIC`. Nothing it fails to resolve can reach the Binance tier.

```
lookupBinancePair(...)
  ├─ pair  → class ticker-binance → tiers ['binance','cgOhlc']  → clean klines
  └─ null  → class address-*      → tiers ['codex','geckoterminal']
```

And because `CODEX_FIRST_BARS` defaults ON (`!== '0'`, deliberate — Gleb 2026-07-30, terminal chart speed: 543ms Codex vs 1.4s GT), everything past the gate hits the **metered** tier first.

Note the Binance tier's own header comment: it was built as a COST measure — *"getBars was 45% of total Codex bill (598K ops/day on Jun 2)"*. So the 44-entry ceiling is also a standing Codex bill.

## B. Coverage measurement (2026-08-27)

Method: CoinGecko PRO `/coins/{id}/tickers?exchange_ids=…`, top 500 by market cap, one call per coin, cached. Full data in the session scratchpad (`cgcov/`).

| ranks | Binance/Bybit/OKX | +10 more majors | our registry |
|---|---|---|---|
| 1-100 | 76% | 90% | 24% |
| 101-200 | 62% | 78% | 12% |
| 201-300 | 41% | 71% | 0% |
| 301-400 | 42% | 66% | 2% |
| 401-500 | 44% | 70% | 0% |
| **1-500** | **53%** | **75%** | **8%** |

Price agreement: exchange vs CoinGecko differed >5% on **1 of 374**. Load errors: 0.

**What the uncovered 25% actually is** — 126 tokens:

```
  39  stablecoins / pegged      — a candle chart is meaningless
  26  tokenized funds and RWA   — BlackRock BUIDL, Janus Henderson,
                                  Superstate, Ondo OUSG, Spiko, VanEck,
                                  Fidelity: NAV instruments, need a NAV line
  14  Tradable private-credit notes (PC00000xx) — do not trade at all
  47  genuinely DEX-only tokens
```

The classifier is a name heuristic and over-counts the last bucket (`USYC`, `SOFID`, `MF-ONE`, `WM`, `DOLA` are really pegs/funds), so the true DEX class is nearer **35**.

**The conclusion inverts the assumption the current architecture was built on.** We treat the DEX cascade as the main road and Binance as a courtesy for a few majors. In reality the exchanges cover three quarters of the top 500 cleanly and for free, a sixth should never be candle-charted at all, and the five-source cascade is the right answer for **under 10%** — which is exactly the OHM / TEMPLE / KOGE / SHFL / YZY class it was written for. Today 92% of the universe rides it, including top-50 majors.

## C. Decisions taken

1. **Holes only.** The CEX lane may only serve tokens where `lookupBinancePair` returns `null` today. It may never displace a chart that currently renders. (Considered and deferred: letting CEX win wherever exchange volume dominates the DEX pool. Better quality and a bigger Codex saving, but it changes charts that work — revisit after this ships and is measured.)
2. **Binance + Bybit + OKX.** Closes 49% of the gap (226 of 462 top-500 tokens absent from the registry). Binance alone is 36% but leaves HYPE broken; all nine venues reach 73% at four times the adapter surface. All three chosen venues were verified with live requests on 2026-08-27.
3. **USD-quoted pairs only** (USDT / USD / USDC). Allowing KRW and EUR adds exactly **1** token across the top 500, and would drag in FX conversion plus the `official-trump → Upbit KRW` mis-pick. Excluded by rule, at no coverage cost.
4. **The last four venues are dropped.** HTX, Upbit, Crypto.com and Bitfinex together add **1** token over the first nine.

## D. Design

### D1. `apps/research/api/_lib/cex-venue-map.js` (new)

```
resolveCexVenue(cgId) -> { venue, pair, base, target, volUsd, ts } | null
```

- **Source:** `GET /coins/{cgId}/tickers?exchange_ids=binance,bybit_spot,okex&depth=false` on `pro-api.coingecko.com`.
- **Filter:** venue in the allowlist; `target` in {USDT, USD, USDC}; `is_stale` false; `is_anomaly` false.
- **Pick:** highest `converted_volume.usd` — the venue where price forms. Same principle as the deepest-pool pin already shipped for the Codex tier (`rz-chart-audit-plan` Step 10).
- **Cache:** KV `bars:cexvenue:v1:<cgId>`, TTL **7 days**. The long TTL is not thrift, it is **stickiness**: ASTER's top venue was Binance on 2026-08-26 and KuCoin on 2026-08-27. Re-picking per request would reintroduce exactly the per-request nondeterminism this work exists to remove.
- **Negative cache:** a clean "no matching ticker" answer caches `null` for 24h. A timeout, non-200, or transport failure caches **nothing** — an empty answer is not a verdict. (Same rule as `verifyToken` in the TG bot, `notification-token-identity.md` §F.)
- **Inline budget:** `AbortSignal.timeout(1200)`. Measured cost of the call scoped to three venues: **358-442 ms**, 6-12 rows. Over budget → return null → the request proceeds exactly as it does today.

### D2. Kline adapters

`fetchCexKlines(venue, pair, resolution, fromSec, toSec)` normalising to the `{t,o,h,l,c,v}` shape every tier already returns.

| venue | endpoint | status |
|---|---|---|
| binance | `api/v3/klines` | **exists** (`fetchBinanceKlines`) |
| bybit_spot | `v5/market/kline?category=spot` | new, verified live |
| okex | `api/v5/market/candles` | new, verified live |

Symbol formats differ (`BASEQUOTE` on Binance and Bybit, `BASE-QUOTE` on OKX) and must be built from the map's `base`/`target`, never by string-munging our own symbol.

### D3. Wiring

- `handlers/bars.js`: after `lookupBinancePair` returns `null`, and only when `reqCgId` is present, `await resolveCexVenue(reqCgId)` and put the result on `ctx.cexVenue`. The handler is already `async` and already awaits in this region. The client supplies `&cgId=` on both chart paths (`codexApi.js:85`, `TradingViewAdvanced.jsx:479`).
- `bars-router.js`: new tier `cex`, registered in `TIER_FNS` and `SOURCE_TO_TIER`.

⚠️ **There are TWO cascade paths and the new tier must enter BOTH.** `SMART_BARS_ROUTER` is opt-in (`handlers/bars.js`, "SMART ROUTER (opt-in via SMART_BARS_ROUTER=1)"), and whether it is enabled on prod is **unverified** — `rz-chart-audit-plan` §A3 hypothesis 3 records that the probe designed to settle it could not discriminate. The default is the LEGACY branch below it. Wiring only `buildTierList` would risk shipping a fix that is invisible in production.

  - **Smart path:** `buildTierList` prepends `cex` when `env.hasCexVenue` is set.
  - **Legacy path:** a guarded `runTier('cex', ctx)` immediately after the existing `if (binancePair)` block — the same position in the order, reached only when Binance did not own the token.

Both are gated on `ctx.cexVenue`, which by construction can only be set when `ctx.binancePair` is null. The holes-only rule is therefore structural in both branches, not a convention someone must remember.
- Cache key gains `:cex:<venue>` so a venue change cannot serve the previous venue's tape.

### D4. What the tier inherits for free

It returns through the same `writeBarsPayload`, so it gets `repairScaledPrices`, `sanitizeBars` and `stitchAdjacentOpens` without new code — and, importantly, the **quote-agreement gate** from Step 9. A ticker collision that survived the cgId keying would still have to agree with the live quote to be drawn.

### D5. Freshness guard (independent of source)

Separate, small, and worth shipping regardless of where bars come from. This alone is the honest answer to the ASTER and WLFI screenshots.

**The server states a fact, it does not decide a policy.** `writeBarsPayload` always emits `meta.lastBarAgeSec = toSec - newestBar.t`. No threshold is baked in, so the rule stays tunable without a deploy and the server cannot lie by rounding.

**The app applies the rule.** A window is called stale when all three hold:

1. it is a **live-edge** request — `toSec` within two intervals of now. A scroll-back window's last bar is old by construction, and gating on that would flag every deep page. Reuse the existing `quoteGateApplies` predicate rather than writing a second one;
2. `lastBarAgeSec > 2 * intervalSec` — one unclosed current bar is normal;
3. `lastBarAgeSec > 0.10 * requestedWindowSec` — a quiet 90 minutes on a thin token inside a 24h window is a real tape, not a fault; forty days inside a 24h window is a lie.

Conditions 2 and 3 must both hold, so a genuinely thin token is never accused of being broken.

## E. Risks

| risk | mitigation |
|---|---|
| breaking a working chart | structurally unreachable — the branch sits behind `null` |
| CoinGecko slow or down | 1.2s timeout, fall through to today's path |
| wrong coin resolved | cgId keying, plus the existing quote gate |
| venue flapping between days | 7-day sticky TTL |
| rollback | `CEX_VENUE_MAP=0` — the tier list reverts byte-identical |
| dev/prod drift | none: dev Express imports the same handler (`packages/server/index.js:8745`) |

**Bundling is NOT a risk here** (corrected from the first draft): `includeFiles` in `vercel.json` is only needed for files outside the `api/` tree — it currently bundles `packages/server/lib/{token-registry,codex-metrics-kv}.js`. A module in `api/_lib/` is traced by import automatically. The failure that killed `token-registry` on trading prod applies to that path, not this one.

## F. Out of scope

`CODEX_FIRST_BARS` is untouched (deliberate call, Gleb 2026-07-30). The DEX cascade is untouched. `token-registry.js` is untouched and keeps serving as the synchronous fast path. The RWA/NAV class gets nothing here — it needs a NAV line, which is its own piece of work.

## G. Cost

One CoinGecko call per token per 7 days. At 5,000 distinct tokens a week that is ~20k calls a month. Plan is Lite: 2,000,000/month, currently 1.26M used, 736k remaining — roughly **1% of the remaining quota**. Expect the Codex bill to fall, since `getBars` on these tokens stops being metered.

## H. Verification

- Unit tests in `apps/research/api/_lib/__tests__/` (`*.test.mjs`, alongside `bars-continuity` / `bars-hole-fill` / `bars-scale-repair`): venue pick is deterministic for a fixed payload; USD-only filter; negative cache only on a clean empty; sticky choice across calls; per-venue symbol formatting.
- Live: the six screenshot tokens render current tapes agreeing with the hero price; BTC/ETH/SOL byte-identical to the pre-change baseline (they never reach the new branch).
- `npm run build:research` clean with `[check-critical-path] OK`.
- After deploy: `X-Spectre-Tier` on `/api/bars` reads `cex` for GRAM/ASTER/WLFI/MORPHO/HYPE, and the Codex `getBars` line drops.

## I. Traps found while measuring — read before implementing

- 🪤 **CoinGecko exchange ids are legacy.** OKX is `okex`, Coinbase is `gdax`, MEXC is `mxc`, HTX is `huobi`, Bybit is `bybit_spot`. Passing `okx` is not an error — it returns **silently nothing**.
- 🪤 **`/tickers` without `exchange_ids` returns page 1 of an unsorted list.** BTC came back as BTCC, Biconomy and Azbit with Binance absent entirely; the first coverage run therefore measured `0/100`. Always scope by venue, or a wash-trade exchange becomes the chart source.
- 🪤 **`trust_score` is `null` on this plan.** Cannot be filtered on. Use `is_stale` / `is_anomaly` plus volume plus our own quote gate.
- 🪤 **Cloudflare returns `error code: 1010` to requests with no `User-Agent`.** It looks exactly like a 403 plan restriction and cost one round of wrong conclusions about which query params the plan allows. Always send a UA.
- 🪤 **The top-volume venue changes between days** (ASTER: Binance → KuCoin in 24h). Any per-request pick is nondeterministic by construction.
- 🪤 **`/coins/markets` does not carry `platforms`**, so coverage work cannot infer a chain from it.

## J. Open

- `ticker-bare` tokens (no cgId anywhere) still get nothing. Unchanged from today, but it is the remaining identity hole.
- CoinGecko's ticker `base` field is a symbol on CEX rows but can be a contract on DEX rows. The venue allowlist should exclude that entirely; confirm with a test rather than by inspection.
- Whether the CEX lane should eventually displace Codex where exchange volume dominates (decision C1) — revisit with measured prod data after this ships.

---

## K. Execution log — 2026-08-27

Shipped to the worktree branch `worktree-cex-venue-map`, five commits, NOT pushed.

| # | commit | what |
|---|---|---|
| 1 | `86531b2cc` | `pickCexVenue` — pure venue choice (8 tests) |
| 2 | `d72aa4b51` | `resolveCexVenue` — KV, 7-day sticky pick, honest negative cache (8 tests) |
| 3 | `8010aaa87` | `cex-bars.js` — Bybit + OKX adapters on the shared bar shape (7 tests) |
| 4 | `02ffd781d` | the `cex` tier in `bars-router.js` (7 tests) |
| 5 | `059dfceda` | wiring in `handlers/bars.js` — BOTH cascade paths |

30 new tests. The three existing bars suites (6 + 14 + 15) pass unchanged after every
commit. `npm run build:research` clean, `[check-critical-path] OK`, entry 0.36MB.

### Verified live, through the real handler

Method: direct handler harness (mock req/res, real env) — the repo pattern from §D3 Steps
9-10. Dev Express imports this exact handler (`packages/server/index.js:8745`), so the code
path is identical; this avoids standing up a server and juggling ports.

**Ticker form** (`symbol=SYM&cgId=…`), the five tokens the founder screenshotted:

| token | tier | bars | last close | venue | vs the Aug-26 hero |
|---|---|---|---|---|---|
| GRAM | `cex` | 24 | **1.398** | binance GRAM/USDT | +0.6% |
| HYPE | `cex` | 25 | **82.23** | bybit HYPE/USDT | +1.6% |
| ASTER | `cex` | 24 | **0.706** | binance ASTER/USDT | +1.3% |
| WLFI | `cex` | 24 | **0.0584** | binance WLFI/USDT | +0.7% |
| MORPHO | `cex` | 24 | 2.69 | binance MORPHO/USDT | +8.9% |

MORPHO's +8.9% is a real day of market movement, not an error — CoinGecko itself moved
2.63 → 2.69 across the same session. GRAM was drawing **0.000686** before this work.

**Address form** (`symbol=0x…:networkId&cgId=…`) — the shape the Research Zone chart
actually sends, and therefore the one that matters. Checked because the ticker-form probe
alone would NOT have proven the fix: a bare ticker classifies as `ticker-cg` and already
had cg-ohlc as a fallback, whereas the address form is the class that was landing on
GT/Codex.

| cgId | address:net | tier | last close | venue |
|---|---|---|---|---|
| morpho | `0x58d97b…c2b2:1` | `cex` | 2.691 | binance MORPHO/USDT |
| aster-2 | `0x000ae3…556a:56` | `cex` | 0.706 | binance ASTER/USDT |
| world-liberty-financial | `0xda5e19…bef6:1` | `cex` | 0.0584 | binance WLFI/USDT |

**Majors regression:** BTC / ETH / SOL all still `tier=binance`, 24 bars. They hold a
registry pair, so they never reach the new branch — as designed.

**Kill switch:** with `CEX_VENUE_MAP=0` every one of the five reverts off `cex`. The lane
is fully inert behind the flag.

**Adapters against the live venues:** bybit HYPE 82.29, okx HYPE 82.275, binance MORPHO
2.707 — all ascending, all current to the hour.

### Not verified

No browser pass. This work stops at the API boundary; that a chart *renders* these bars is
inherited from every other tier going through the same `writeBarsPayload`, but it has not
been looked at on a real screen.

### Trap found during execution

An ESM harness that reads `.env` in its body and imports the handler at the top **fails
with `CODEX_API_KEY not configured`** — imports are evaluated before the body, and the
handler reads `process.env` at module scope. Load the env first, then `await import()`.

### K2. Second verification pass — gaps closed, and two corrections

Prompted by "did you actually test everything?". The honest answer was no; this is what
that pass found.

**Closed:**

- **Dev/prod parity (the one that mattered).** `vercel.json` rewrites `/api/bars` →
  `/api/trade-api?fn=bars`, and `apps/research/api/trade-api.js:13` imports
  `./_lib/handlers/bars.js` — the same module. The fix reaches prod. Both new modules sit
  inside `api/_lib/`, so Vercel traces them by import; no `includeFiles` entry is needed.
- **Every resolution, end to end** (ASTER, binance): 1m→360 bars, 5m→288, 15m→288,
  60→24, 240→180, 1D→200, 1W→47 — all `tier=cex`, all agreeing on the last close. The
  interval maps are correct in practice, not only in unit tests.
- **The OKX venue.** Neither the ticker nor the address probe had exercised it (they
  picked binance and bybit). OKB 113.4, ORDI 4.217, ARKM 0.1121 — `tier=cex`,
  `venue=okx`, at 60 and 1D.
- **A coin with no allowlisted pair falls through, it does not blank.** BUIDL and OHM
  resolve `venue=null` and land on `cg-ohlc` with 24 bars.
- **The KV cache is real, not just unit-tested.** `bars:cexvenue:v1:aster-2` holds
  `{"v":{"venue":"binance","base":"ASTER","target":"USDT","volUsd":7040999}}`; a warm
  resolve is **132 ms** against 358-442 ms cold. Note ASTER locked to binance even though
  KuCoin had the deeper book hours earlier — the stickiness is doing its job.

**⚠️ Correction 1 — the registry is 59 symbols, not 44, so §B overstated the loss.**
`lookupBinancePair` checks `BINANCE_MAJORS_FALLBACK` (52 entries) **unconditionally**,
despite its own comment saying "only if registry didn't load" — there is no such guard in
the code. The effective pre-existing registry is therefore `TOKEN_REGISTRY ∪ FALLBACK` =
59. Recomputed:

| | top-100 | top-500 |
|---|---|---|
| covered by the effective registry | 34 (not 24) | 51 (not 38) |
| covered by the CEX lane | 90 | 374 |
| **tokens this work newly serves** | **56** (not 66) | **323** |

Still the dominant share of the universe, but the number in §B was wrong and this is the
right one. Found only because FIL routed to `binance` in a probe, which it should not have
under the 44-entry reading. The comment/code mismatch in `lookupBinancePair` is
pre-existing and benign — the fallback data is correct — but the comment lies and should
be fixed by whoever next touches that function.

**⚠️ Correction 2 — the TradingView UDF lane does NOT get this tier.**
`handlers/tradingview-udf.js` carries its own inline cascade that mirrors bars-router
rather than calling `runTier` (its own comment at :775 describes it as
"binance → GT → cg-ohlc → codex"). So:

- **Fixed:** every consumer of `/api/bars` — the canvas Candles/Line charts, and the
  Research Zone TradingView tab, which fetches `/api/bars` directly. That covers all six
  founder screenshots.
- **NOT fixed:** consumers that go through `/api/tradingview/udf/history` — LITE, monarch,
  the home chart panel, and the trading app's TVA. Those keep today's behaviour.

Extending the lane to the UDF cascade is a coherent follow-up, deliberately not smuggled
into this change: it is a second cascade with its own guards and its own tests, and the
plan's scope was `/api/bars`.

**Still not verified:** no browser pass. This work ends at the API boundary.
