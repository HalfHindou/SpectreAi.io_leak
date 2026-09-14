---
paths:
  - "apps/research/src/pages/lite/**"
  - "apps/research/src/pages/screener-lite/**"
  - "apps/research/api/_lib/**"
---

# LITE Cinema charts — on-chain tokens chart correctly there too

**Created:** 2026-08-21
**Owner:** Evgeniy
**Status:** SHIPPED to a branch on top of PR #1449; browser-verified on dev
**Companion:** `charts-system.md` §I3–I10 (the LITE identity/chart history), PR #1449 (`lite: recover on-chain identity from CoinGecko and stop charts lying on thin tokens`)

---

## A. What this is, and what it deliberately is NOT

PR #1449 fixed the LITE **Research** view's identity chain: board clicks carry
`cg_id`, `resolveCgPlatform` recovers a verified contract+chain from CoinGecko,
`resolveCgId` gained a normalized-name rung, plus the candle gate, XRPL, the
sparse-cadence auto-step and the resilience fixes.

It did not touch **Cinema** (`pages/screener-lite/components/sl-*`, reached from
the Cinema button; `/screener-lite` has no route of its own). Cinema had its own,
much weaker identity path and was still the surface the founder screenshotted:
an on-chain token opened at **$0** with "No chart data" while Research charted
the same token fine.

So this work is deliberately narrow: **make Cinema consume Research's lanes**,
plus one correctness patch to `resolveCgPlatform` that Research needs anyway.

⚠️ **A module extraction was written and thrown away.** The first attempt moved
~700 lines of identity/series/TV helpers out of `lite-research.jsx` into three
modules. It was built and verified — and then dropped, because it conflicted
irreconcilably with #1449, which added 233 lines *into* the same file. The
extraction is still the right idea (three surfaces resolving identity three ways
is why the same bug keeps being fixed repeatedly), but it belongs in its own PR
when that file is not actively changing. Cinema now imports the primitives from
`lite-research.jsx` instead, which is a thin adapter, not a second resolver.

---

## B. Cinema: what changed

| File | Change |
|---|---|
| `sl-identity.js` (new) | `resolveCinemaRef(row)` — list row → `{kind: stock\|onchain\|cg\|unknown, cgId, contract, chain, networkId, quote, name, image}`, TTL-cached. Every primitive imported from `lite-research.jsx`. |
| `sl-tv-chart.jsx` (new) | TradingView primary chart with Research's own props contract; interval pills from `lite-research`'s TV ladder; lightweight `SLChart` as the automatic fallback. |
| `sl-token.jsx` | Dropped its `searchTokens` first-hit contract hunt (the banned clone-collision move). Lanes are now resolver-driven; the view fills from the trusted quote and distrusts the row price when kind=onchain and the GT pool disagrees >1.5x. Feeds the TV pane a `~1Y` `loadDailyWindow` walk for its history span / dead-tape anchor. |
| `sl-chart.jsx` | Refuses a bare ticker unless the symbol is a mapped major or a cgId is known — otherwise an honest empty state instead of a twin's tape. |
| `screener-lite.css` | `.sl-tv-embed` frame. |
| `codexApi.js` | `getBars` dedup key includes `cgId` (two coins sharing symbol+window no longer collide in flight). |

Rules Cinema now inherits rather than re-implements: on-chain caps chart by
CONTRACT only; a CG-listed coin's contract comes from CoinGecko's platform
record (pool-ratified); the box's symbol-keyed row is never the trusted quote;
`referencePrice` reaches TVA only when the quote is trusted (its bad-data guard
kills the chart at >100x drift).

`SLTvChart` also holds a shimmer while identity resolves instead of falling
through to `SLChart` — the fallback keys off `token.address`, which is empty
until the resolver lands, so rendering it early fired a bare-ticker `/api/bars`
(measured on PORTAL) that can briefly paint a same-ticker twin.

---

## C. The `resolveCgPlatform` patch: compare candidates, don't take the first

#1449 ratifies the picked platform against a GT pool (`liquidity >= 500`) but
picks a single candidate: `asset_platform_id`, else the first mappable key. A
floor is not a comparison, and on a multi-chain token that is decided by
CoinGecko's key order. Measured 2026-08-21 on **PORTAL** (`portal-2`):

| chain | GT deepest pool | pool price | 5m bars | 1h bars |
|---|---|---|---|---|
| **base** | **$60,250** | **$0.01118** ✅ | **500** | **1078** |
| ethereum (= `asset_platform_id`) | $5,344 | $0.01019 | 80 | 290 |
| solana | $30,430 | $0.02211 (2x off) | 7 | 47 |

CoinGecko quotes $0.01119, so Base is the price-forming venue. Ethereum clears
the $500 floor and was therefore chosen — 80 bars at 5m, which is the founder's
"5m/1h/1D/1W have no data" report. (Charting Solana, which an earlier hardcoded
chain ranking did, gave SEVEN.)

The pick now: **the pool price must agree with CoinGecko's** (the price-forming
venue does by definition; a thin bridge pool drifts), and among those the
**deepest reserve wins**. Depth alone would have chosen Solana here — its pool is
deeper than Ethereum's and quotes a price nobody trades at. Single-deployment
tokens short-circuit with no extra requests; the `$500` floor survives as
`MIN_PLATFORM_LIQUIDITY`; "a failed fetch is not a failed lookup" is preserved.

Also: the Research→Cinema handoff no longer passes the TICKER as `name`. That is
worse than passing none — `resolveCgId` compares it against CoinGecko's coin
*name*, and a ticker that fails to match retires the search instead of letting
the logo / unique-name / rank rungs decide.

---

## D. Verification (dev, browser, DOM-read)

- **PORTAL** — Research hero $0.0112 with a TradingView tab; TV requests
  `…acb2d:8453` (**Base**, was Ethereum). Cinema chip reads "PORTAL **BASE**",
  $0.0112, 5m pill requests res 5 on 8453, all seven pills present. Bar density
  on Base: 1m 499 · 5m 500 · 15m 1111 · 1h 1078 · 4h 721 · 1D 209 · 1W 31.
- **EYE** — board click → Research "BULLS'S EYE" $0.001117 → Cinema "EYE SOL"
  $0.001130 with the TV pane on the Solana mint `RmtM…NDYk` (its only platform).
  Matches CoinGecko `bulls-s-eye`; the box row for that ticker is Behodler.
- Zero bare-ticker `/api/bars` calls remain on these paths; zero console errors;
  `npm run build:research` clean with `[check-critical-path] OK`.

**Known, unchanged, not a regression:** opening a long-tail ticker *without* a
board seed (e.g. session-restored `GME`) resolves the coin the BOX row describes
and shows its numbers self-consistently — there is no better information
available at that point, and `main` behaves the same. The seeded path (how users
actually arrive) is correct.

🪤 The TradingView pane MOUNTS and its datafeed requests the right contract, but
candle **painting** is unverified — the automation tab is `document.hidden`,
which freezes rAF. Worth one look on a real visible window.

---

## E. Open

1. **The module extraction** (§A) — worth doing on top of this, as its own PR.
2. A hardcoded "where the tape usually is" chain ranking must never come back;
   multi-chain identity is a measurement (§C).
3. Cinema's neighbor-card identity prefetch was dropped to keep `lite-cinema.jsx`
   out of the diff. Cheap to add back with a dynamic import (a static one would
   create a cycle: `lite-research → lite-cinema → sl-token → lite-research`).
