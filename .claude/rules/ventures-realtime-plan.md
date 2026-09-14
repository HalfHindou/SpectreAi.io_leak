---
paths:
  - "apps/research/src/pages/ventures/**"
  - "apps/research/src/pages/private-markets/**"
---

# Ventures / Private Markets — Realtime Plan

**Created:** 2026-07-05
**Owner:** Sunny
**Trigger:** "venture data looks stale and dry.. can never happen must be realtime." The Ventures → Smart Money surface reads like a frozen database.

---

## A. Audit — what is static vs live (measured 2026-07-05)

### Ventures → "Smart Money" (VCIntelHub, the default view)
| Layer | Source | State |
|---|---|---|
| 78 fund entities (identity, tier, focus, thesis) | bundled `vc-database.json` (60KB) | **STATIC** — only a redeploy changes it |
| Fund AUM (a16z `$7.6B`), founded, HQ | `vc-database.json` `aum_estimate/founded/hq` | **STATIC** |
| Investment count (a16z `190`) | `vc-database.json` `total_investments_tracked` | **STATIC** |
| Portfolio (`known_portfolio_tokens/companies`) | `vc-database.json` curated lists | **STATIC** names; now price-overlaid live (Phase 1) |
| Per-fund rounds (`useVcInvestments`) | `/v1/fundraising/rounds?investor=` | **LIVE endpoint, STALE data** — flagship funds top out in 2024 |
| Institutional scores | `/v1/institutional/scores` | scores present, **market fields null** (mcap/price/vol/%chg) |
| Market Pulse (upgrades/downgrades) | `/v1/institutional/upgrades` | **EMPTY at 7d AND 30d** |
| Sector Map momentum, Deal Flow prices | `/v1/prices` | **LIVE** (30s poll) |
| Live Pulse (fund X timelines) | `/api/tweets/official` | **LIVE** (X post cadence) |

**Systemic staleness proof** — newest round per flagship fund (`/v1/fundraising/rounds?investor=X`):
a16z 2024-05-21 · Paradigm 2024-11-21 · Sequoia 2024-03-01 · Pantera 2024-07-17 · Dragonfly 2024-06-28 · Multicoin 2024-03-06.
Yet the aggregate graph has fresh rows (newest **2026-07-04**) — so the ingestion has recent rounds but does **not attribute them to the tracked flagship funds**. Total graph is small: `199 rounds / 101 investors / $22B` (`/v1/fundraising/stats`).

### Private Markets
Largely **LIVE** already: deal feed = DeFiLlama `/raises` (15m) + TechCrunch/Bloomberg/Crunchbase RSS (15m) + SEC EDGAR Form D (30m) + Spectre fundraising graph (2m) + curated seed; client polls 2m (adaptive). Company news / stock quotes / predictions / tweets live. Only the curated seed + unicorn board are editorial-static. **Not the problem** — its only weakness is leaning on the same 199-round graph.

---

## B. Phase 1 — App lane (SHIPPED this PR, no backend deploy)

`apps/research/src/pages/ventures/components/vc-intel-hub.jsx` (+ `.css` / `.day-mode.css`):
- **Live header stats** from the fundraising graph (`computeLiveFundStats(rounds)`): the frozen `total_investments_tracked` is replaced by the live round count (labeled `live`, falls back to the seed labeled `est.`); AUM is marked `est.`; new **"Deployed (tracked)"** tile sums live round amounts; new **"Last active"** tile shows a VC-cadence recency chip (fresh <90d / slowing <1y / dormant) — this makes the 2024 gap **honest and visible**, and auto-heals when Phase 2 lands.
- **Price-overlaid portfolio** — holdings chips (`TokenChip`) now show a live 24h change badge from the shared `/v1/prices` feed (already fetched by `useUniversePrices`, 30s poll); a "live prices" marker appears on the source line when the overlay is warm.
- FreshnessTag was intentionally NOT reused for last-active — its tiers are minute/hour scale (built for price cadence); a purpose-built recency chip fits fundraising cadence.

Polling was already adequate (`useUniversePrices` 30s guarded; `useVcInvestments` per-entity cached — round data doesn't change intra-session).

**Not touched:** the Deal Flow "Market Pulse" strip already returns null on the empty `/institutional/upgrades` feed (degrades gracefully, no dead section) — Phase 2 fills it.

---

## C. Phase 2 — Data-api lane (ROOT CAUSE — Hetzner `204.168.244.18:3850`)

The app now surfaces live data honestly, but the feeds behind it need fixing at the source. All three are backend-only.

1. **Fundraising ingestion coverage + attribution (the big one).**
   - Symptom: `?investor=a16z` (and every flagship) returns only a 2024-era seed; fresh 2026 rounds exist in aggregate but aren't tagged to the tracked funds.
   - Fix: a scheduled worker pulling **DeFiLlama `/raises`** (has `leadInvestors` / `otherInvestors` per round) that upserts into the `fundraising_rounds` table with investor names **normalized to match the app's `API_NAME` map** (`useVcInvestments.js` — `a16z-crypto→a16z`, etc.). Then `?investor=a16z` returns 2026 rounds and every fund's Activity panel + the Phase-1 "last active" / "deployed" tiles go live automatically.
   - Verify: `curl -H "X-API-Key: $SPECTRE_API_KEY" '.../v1/fundraising/rounds?investor=a16z&limit=5'` → a 2026 date on top.

2. **Populate `/v1/institutional/upgrades`** (empty at 7d and 30d).
   - Verify the scoring worker writes score history and emits tier-crossing (speculative→emerging→institutional) signals so the Market Pulse feed returns rows.

3. **Add market fields to `/v1/institutional/scores`** (mcap/price/vol/%chg are null).
   - Join the live market overlay into the scores response so the app stops client-patching via `/v1/prices` + `SPECTRE_OVERRIDES`.

---

## D. Phase 3 — Data-api durability (later)

Move the 78 fund entities (identity / AUM / portfolio / thesis) out of the bundled `vc-database.json` into a data-api table (`vc_entities`), served via `/v1/vc/entities`, so fund cards update without an app redeploy. Enrich AUM from a live source where available (DeFiLlama for on-chain funds; live AUM/NAV for the asset-manager/ETF entities already in the DB — Grayscale, IBIT, ARK, etc.). This is the real cure for "static file"; Phase 1 makes the surface honest in the meantime.

---

## E. Access map
- **App:** `apps/research/src/pages/ventures/components/` — `vc-intel-hub.jsx` (Smart Money), `useVcInvestments.js` (`API_NAME` map), `useUniversePrices.js` (`/v1/prices`), `ventures-api.js` (`/v1/institutional/*`), `vc-database.json` (the static seed).
- **Private Markets:** `apps/research/src/pages/private-markets/` + `packages/server/lib/private-markets-core.js` (deal-feed sources) + prod handler `apps/research/api/_lib/handlers/extended-proxy.js`.
- **Data-api (Hetzner `204.168.244.18:3850`, `X-API-Key: SPECTRE_API_KEY`):** `/v1/fundraising/{rounds,stats}`, `/v1/institutional/{scores,upgrades}`, `/v1/prices`.
- **v1-proxy:** prod `/data-api/v1/*` → `extended-proxy.js` `handleV1Proxy` → `SPECTRE_API_BASE` (`http://204.168.244.18:3850`).
