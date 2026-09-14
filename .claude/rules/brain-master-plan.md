---
paths:
  - "apps/research/src/pages/brain/**"
  - "apps/research/api/_lib/handlers/brain*.js"
  - "packages/server/agents/**"
---

# Spectre Brain — MASTER PLAN: from consciousness to trading

**Created:** 2026-07-06 · **Owner:** Sunny + Claude · **Status:** Phase 1 in progress
**Companion:** `BRAIN_HANDOFF.md` (vision + run steps) · `.claude/rules/social-trading-agent-plan.md` (proven alpha recipe) · `~/spectre-rz-ta-audit-2026-07-04.md` (TA audit)

This is the single source of truth for building the Brain into a system that: understands the market → reads charts (multi-timeframe TA) + sentiment → hunts for edge 24/7 → writes trade theses → validates them (backtest + paper) → grades every outcome and learns → eventually executes (Hyperliquid perps + on-chain), gated by proof.

---

## 0. Ground truth (from the 2026-07-06 triple audit — engine, backend, design)

What is REAL today:
- A 24/7 learning loop already runs on Hetzner (~185 pm2 procs): grader-v2 has graded **831 calls in 30d — 39% hit-rate overall, 48% at 24h, 14% at 30d**. The brain's long-horizon calls LOSE. This scorecard exists and nothing conditions on it.
- 4 paper agents (id 9–12, `social_conviction` family) racing since 07-03: agent 9 **+2.86%** (3 open runners), 10/11/12 slightly red — all 16 closed trades were `doa_stop` at ≈−$32 (working as designed). 14/60 trades toward the ≥15/agent verdict gate.
- The proven causal edge (alpha audit): depth-size + entry <$2M + first-12h author-breadth ≥5–8 + vol-scaled trailing = +50–71% backtest. **HARD CAP: ~$1k positions; edge inverts at $10k.** This edge alone does not "make millions" — it makes a track record. Scale requires new edges (majors/perps) that must be EARNED through the same gates.
- Hyperliquid: read-only ingestion exists (`worker-hyperliquid-tracker`, `/v1/derivatives/hyperliquid`). **Execution code: ZERO anywhere** (no signing, no orders, no keys). Greenfield, deliberately last.

What is BROKEN in the current desk (the /brain consciousness):
1. **No outcome ledger / self-grading** — convergence calls carry no ID, no entry price, no join to what happened. The brain cannot learn. (Blocks everything.)
2. **No trade-thesis schema** — no entry, invalidation, horizon, target. Market commentary, not trades.
3. **No prices in context** — the LLM reasons with zero live prices/candles; it cannot state levels.
4. **Dead track-record feedback** — prompt says "condition on your track record" but is fed `hit_rate: null` while the 831-call scorecard sits unfetched one endpoint away.
5. **Blind 30k truncation** — `JSON.stringify(user).slice(0,30000)` amputates the context tail (track record first).
6. **Garbage-in launders to conviction-80** — "ETH outflow of 68913077.3" (≈$250B, unit error) cited as a top signal; direction sanitizer defaults anything non-bear to BULL.
7. **Prod doesn't think on its own** — no cron; generation is traffic-driven with a build-time-frozen JSON fallback. Dev loop = `while true` in a Mac terminal (SPOF).
8. **Split brain** — prompt/gather/sanitizers duplicated in `_desk-gen.mjs` (dev) + `_lib/handlers/brain-desk.js` (prod), already drifted; two memory stores that never meet.
9. **Lens agents are cosplay** — one call, lens labels as vocabulary. Convergence ≠ independent agreement yet.
10. **Coverage gaps** — unfed but live on the box: `kol`, `x_intelligence`, `news`, `hacks` (scam), `predictions` (politics odds), `smart_money`, live prices, candles. HL-specific perps context absent. The board is more aware than the brain reading it.
11. Paper-trader `pnl_unrealized` sign bug (agent 9 shows $6,732; truth ≈ +$714). Equity/return columns are correct.
12. Design: hero shows mood, not the read (`TheRead` is dead code); triple-redundant "aligned assets" story; 26-card gray awareness wall; 6–8 decorative hues; dead Crypto/TradFi toggle.

**Operating principles (non-negotiable):**
- **Test before capital. Always.** Every strategy passes: backtest → paper (≥15 closed, positive after fees, forward not curve-fit) → testnet → tiny live → scale.
- **Every call is graded.** If a surface makes a claim with direction, it gets an outcome row.
- **Grounded numbers or nothing.** A signal without a unit and a meaning does not enter the context.
- **One brain.** One shared core, one memory store, one scheduler. No dev/prod prompt drift.
- **Honesty in UI.** Never render a fake control, a fabricated number, or an ungraded claim as proven.

---

## 1. The development model (how we build)

**Two lanes, one loop:**
- **ENGINE lane** — data-api on Hetzner (`/opt/spectre-data-api`, pm2, Timescale). This is where the 24/7 agent team lives. Pattern per worker: one file in `src/workers/`, one `ecosystem.config.js` entry, env from box `.env`, idempotent writes (unique indexes), structured logs. SSH works; deploy = migration + `pm2 start/reload`.
- **FACE lane** — the app `/brain` page (this worktree, PR #1217 lineage → `main`). The app is a **pure reader** of engine outputs. No LLM generation in the request path.

**Phase gates:** a phase ships → runs long enough to grade → the graded result decides the next phase's parameters. We do not build execution before validation proves an edge, and we do not trust a backtest that hasn't survived forward paper.

**Cadence stack (target):** desk cycle 10 min (worker) · desk-call grader hourly · signal backtester 4h · lessons 2h · hunter 15 min · X-study daily digest · paper trader 5 min (exists).

---

## 2. The algo (consciousness architecture)

```
PERCEIVE (all domains + candles + sentiment + X + macro/politics + HL perps)
  → NORMALIZE (units, sanity bounds, asset resolution to symbol+contract)
  → REMEMBER (prior read + rolling ledger + lessons)          [memory]
  → GRADE (score every past call vs price; feed hit-rate back) [learning]
  → HUNT (anomaly scan vs baselines; find the unknown-unknowns) [search]
  → DEBATE (specialist lens agents disagree; critic attacks)    [teams]
  → THESIS (trade_idea objects: entry/invalidation/target/size) [ideas]
  → VALIDATE (auto-backtest + paper agents incl. HL-paper)      [proof]
  → EXECUTE (gated, capped, kill-switched)                      [endgame]
  → outcomes flow back to GRADE. The loop compounds.
```

**The `trade_idea` object (the atom of the system, Phase 4 target):**
```json
{ "id": "...", "asset": "ETH", "contract": null, "venue": "hyperliquid|onchain",
  "direction": "long|short", "entry_zone": [x, y], "invalidation": z,
  "exit_logic": "trail30_vol_scaled|target", "conviction": 0-100, "horizon": "4h|1d|1w",
  "size_logic": "depth_1pct_pool|fixed", "thesis": "...", "signals": [...],
  "lens_votes": {...}, "critic": "...", "status": "draft|paper|invalidated|hit|expired",
  "entry_price_snapshot": p, "ts": "..." }
```

---

## 3. Phase plan

### PHASE 1 — THE TRUTH LOOP — ✅ SHIPPED 2026-07-06 (app `6f81c41e` + data-api `9f5a337`)
Engine is CANONICAL: pm2 workers `brain-desk-generator` (10-min cycle → `brain_desk_calls` ledger + `brain_desk_state`, migration 128) + `desk-call-grader` (hourly, candles_1h checkpoint prices) live on Hetzner; route `GET /v1/brain/desk` (payload + desk scorecard); app hook reads engine → serverless → static. `pnl_unrealized` sign bug fixed (agent 9: $6,732 → +$714 true). Engine desk-core = CJS port at data-api `src/brain/desk-core.js` — **keep it in sync with the app's `_lib/desk-core.js`** (app copy = fallback/dev only). Clean data-api worktree holding the deployed commit: `/Users/sunny/spectre-data-api-desk-wt` (the main local checkout is stale/diverged — don't build from it).
1.1 **desk-core extraction** — one shared module (prompt + gather + normalize + sanitize + schema) consumed by `_desk-gen.mjs` (dev) and `brain-desk.js` (prod). Kills split-brain.
1.2 **Trade-read schema** — convergence gains `invalidation` (a level or condition), `horizon`, `entry_ref` (price at call time). Direction must be explicit `bull|bear` — invalid → REJECT the row, never default to bull.
1.3 **Outcome ledger** — every convergence call persisted `{id, asset(normalized), direction, conviction, entry_price, signals, ts}`. Dev: JSONL next to brain-desk.json. Prod/engine: `brain_desk_calls` table on Hetzner.
1.4 **Desk-call grader** — new worker cloned from grader-v2's shape: hourly, grades ledger rows at 4h/24h/7d vs prices, writes hit/miss/pnl, seeds lessons. (grader-v2 pattern: idempotent unique index, resolution guards.)
1.5 **Close the feedback loop** — context now leads with: live grades-v2 scorecard + the desk's own graded ledger ("your last 20 calls: 45%, you overcall bull in chop"). Per-domain context budgets replace the blind 30k slice.
1.6 **Prices + hygiene** — live prices for every convergence candidate in context; unit normalization + sanity bounds on flows (drop or flag absurd figures); the anti-slop line restored to the prompt ("never state a number without what it MEANS").
1.7 **Engine-side generation** — move the desk cycle to a Hetzner pm2 worker (`brain-desk-generator`) writing to KV/table + `/v1/brain/desk`; app hook reads engine first, falls back to current paths. Kills the Mac-terminal SPOF and traffic-driven thinking.
1.8 **Fix `pnl_unrealized` sign bug** in paper-trader snapshot (backup branch → main → deploy).

### PHASE 2 — CHART EYES + TA & SENTIMENT (the user requirement: "read charts, zoom out, technical and sentiment analysis")
2.1 **Multi-timeframe chart context** — per convergence candidate + majors (BTC/ETH/SOL): candle snapshots at 1h/4h/1D/1W ("zoom out" = the higher-TF read always frames the lower), from `candles_1h` + `price_history_daily`. Computed server-side into a compact `chart_read` blob: trend structure (HH/HL vs LH/LL), RSI(14) Wilder, ATR%, distance to key S/R (prior swing highs/lows, round numbers), volume vs 20-bar average, funding/OI overlay for perps.
2.2 **Respect the RZ TA audit** (`~/spectre-rz-ta-audit-2026-07-04.md`): the math must be Wilder-grade with honest null warm-ups; ONE engine (no Cutler-vs-Wilder disagreement); regime-aware framing (overbought in price-discovery ≠ bearish); no fake MTF on thin candles (if same 18 candles on all TFs, say so); volume in every thesis.
2.3 **Sentiment lens becomes real** — feed the desk: crowd-stance (bull/bear % from posts), cross-cluster breadth (PR #1215 archetypes — organic vs single-cluster), mindshare trend, KOL conviction (`kol`, `x_intelligence` domains), narrative onset ("new colors" diffusion). Sentiment divergence (price up + crowd flipping bear) becomes a first-class signal.
2.4 **Scam/safety gate** — any on-chain idea passes: `hacks` domain check, honeypot/buy-sell tax (the RZ `use-token-safety` lookup), holder concentration, CA-match share (fresh-launch authenticity). Fails → `avoid` tag with the reason. This is the "understands the good the bad the scam" pillar.
2.5 **Macro/politics** — `predictions` (Polymarket odds incl. politics), `calendar` (CPI/FOMC/auctions), `news` domains into the Macro lens with event-time awareness ("CPI in 18h" changes what you hold).

### PHASE 2.5 — THE KNOWLEDGE SPINE — slice 1 ✅ SHIPPED 2026-07-06 (data-api mig 129, workers brain-intel-extractor/brain-grounding/brain-project-resolver live; registry 1338 projects/1189 contracts; reinforcement dedupe proven; routes /v1/brain/{intel,grounding,projects/registry}). Slice 2 (2.5.4–2.5.6) ✅ SHIPPED 2026-07-06 (`fdd2d4a`+`c76bec7`, mig 130): worker `brain-attention-clocks` (15-min sidecar over kol_mentions∪social_mentions — momentum-calculator untouched; spiking/active_hours/climbing w/ concentration penalties/trajectory/stability rank-band labels, 30h honest rank backfill seeded labels day-one), `src/brain/providers.js` (GoPlus security.check evm+solana, DeFiLlama defi.protocol/tvlChart — budgeted+15-min cached+fail-soft), desk generator post-LLM federation (GoPlus verdict OVERRIDES LLM safety on on-chain candidates, ≤10 calls/cycle, tvl>0-gated fundamentals) + brain_desk_history append (30d), routes /v1/brain/attention + /v1/brain/lookup + `?at=` time-travel on /desk (as-of scorecard) + /intel (recomputed reinforcement) w/ provenance live|historical + hard look-ahead guards. Remaining: embedding-sim intel merge, `neighbors` co-mention graph, 2.5.7 output-discipline contract. Next mig=131.
(the aixbt adoptions — see `.claude/rules/aixbt-superagent-study.md`)
How aixbt "knows everything": entity resolution + reinforced fact ledger + query-time federation + mechanical output discipline — NOT exotic data (no wallet indexer; no self-grading — grading is OUR moat, keep it). Adopt in this order:
2.5.1 **Entity spine** — `brain_projects` registry (project_id, xHandle, cgId, `contracts[]{chain,address,source,confidence}` incl. tweet-extracted CAs per ca-match spec) + resolution worker; migrate brain joins from symbol/cg_id → project_id. Kills the $DOT/usedot-ai identity bug class at the root.
2.5.2 **Reinforced intel ledger** — `brain_intel` (aixbt's 12-category enum verbatim; repeated mentions REINFORCE one row: observationCount + activity timeline + citations + hasOfficialSource) + extractor worker; desk cites intel ids, not raw chatter.
2.5.3 **Grounding primitive** — hourly `brain-grounding` worker (crypto+tradfi bullets) → `/v1/brain/grounding`; prepended to every brain LLM pass.
2.5.4 **Three attention clocks + stability** — momentum_scores += climbing_score (concentration penalties), active_hours, stability_label (flash/fresh/persistent/durable), trajectory; + co-mention `neighbors`.
2.5.5 **Provider federation** — engine registry: `security.check` (honeypot/tax/holder-concentration), `defi.tvl/fees` (DeFiLlama), `market.*` — per-candidate mid-cycle. This completes the 2.4 scam gate + the "defillama stuff".
2.5.6 **Time-travel** — `?at=` + provenance on /v1/brain/desk + board + momentum → the Brain's own knowledge state becomes backtestable (feeds 5.3).
2.5.7 **Output-discipline schema contract** + interpretation playbook as pattern-rules (momentum+no-intel=hype; reinforced multi-cluster=credible; decay+active-intel=priced-in).
Later: MCP over /v1/brain/*, Observers (top-5 conviction alerts). One pipeline many faces: PR #11's `/take` = the single per-project opinion everywhere.

### PHASE 3 — THE HUNTER (autonomous edge search — "find what I forgot to show it") — ✅ SHIPPED 2026-07-06 (data-api mig 131, worker `brain-hunter` live on pm2)
- Worker `brain-hunter` (15 min, SQL-first, zero LLM): (a) anomaly z-scores — funding (30d hourly, `funding_rate_1h`, |z|≥4, contrarian direction), OI Δ24h (14d 4h-buckets, `open_interest_1h`, |z|≥3.5 + ≥10% move), hourly volume (same-hour-of-day baseline kills diurnal FPs, z≥3.5 + 3×), social mention velocity (14d `momentum_scores` hourly, z≥3); (b) listing — first-seen <24h + author-breadth ≥5 (the causal recipe selector) + budgeted GoPlus gate (flagged = recorded, NO direction); (c) narrative-onset — ≥2 new clusters in 24h while stability flash/fresh; (d) prediction swings ≥15pts/24h vs SELF-BUILT hourly odds snapshots (`hunter_odds_snapshots` — upstream `prediction_prices` dead since 04-07); (e) divergence — price vs mention-velocity + funding-z vs 24h trend.
- Output: `hunted_edges` rows (once/day dedupe per detector+project+sub-metric; directional edges carry entry_price; desk-call-grader grades at 24h, hit = signed pnl ≥ +0.5%). `GET /v1/brain/hunter` = latest 40 + per-detector 7d hit-rates. Desk gathers top-8 fresh as `hunted_edges` domain (budget 1100, prompt rule: early unconfirmed leads, corroboration = convergence candidate, respect detector hit-rates); generator marks fed rows `surfaced_to_desk`.
- 🪤 Engine reality: set-based joins into the realtime caggs (candles_1h/momentum_scores) blow the box's 30s statement timeout — candle/social reads are per-asset (chart-read pattern) over a hard-capped universe; caps = 12 inserts/cycle round-robin across detectors, 6 GoPlus calls/cycle. Day-one live yield: 12 edges (4 funding, 2 OI, 1 social, 2 listings, 3 onsets); volume/swing/divergence honest-zero (swing needs 24h of own snapshots).

### PHASE 4 — AGENT TEAMS + THE IDEA BOOK (specialists that debate)
- Split the single LLM pass into **real agents**, each with its own data slice + memory + graded track record: `Chartist` (Phase-2 TA), `Sentiment`, `Onchain/Flows`, `Leverage/Derivs`, `Macro/Politics`, `Degen/Trenches` + the `Hunter` feed.
- **Debate → converge:** each lens emits stance+conviction+evidence per asset; a synthesis lead resolves; a **Critic agent** adversarially attacks every surviving thesis (steelman the other side, check invalidation is falsifiable); a **Risk manager** sizes (depth-aware, capacity-capped) or vetoes.
- Output: the **Idea Book** — ranked `trade_idea` objects (§2 schema). Convergence now means independent agents actually agreed.
- Cost control: lens agents can run on cheap models (Groq); only synthesis/critic need the big pass. Budget per cycle, cached.

### PHASE 5 — VALIDATE (ideas → proof)
5.1 **Idea-driven paper agent** — extend `worker-paper-trader` with strategy `brain_ideas`: consumes the Idea Book, opens paper positions per `size_logic`, honest fees+slippage (exists). Memecoin ideas use the proven recipe rails.
5.2 **Hyperliquid PAPER perps** — new paper venue marked to HL prices (feed already ingested): majors long/short with leverage simulated honestly (funding paid/received, liquidation price tracked, forced-liq = account rekt in paper too). This is where "high lev" gets tested without burning a dollar.
5.3 **Auto-backtest harness** — generalize `worker-signal-backtester` into a strategy backtester (arbitrary entry/exit rules over `candles_1h`), so every new idea-pattern gets a historical read before paper. Survivorship-honest (the alpha-audit lesson: no look-ahead windows).
5.4 **Verdict gates** (per strategy): ≥15 closed paper trades, positive after fees, max-drawdown bounded, exit fills sane, AND forward (not backtest) — then and only then eligible for Phase 6.

### PHASE 6 — EXECUTE (the endgame, gated)
- **Hyperliquid first** (cleanest API): testnet → tiny mainnet caps. Isolated wallet with a hard ceiling (only what it's allowed to lose), API-wallet signing on the engine box, idempotent order client, position reconciliation loop, kill-switch (one command flattens everything), drawdown halt (auto-stop at −X%), per-trade + daily loss caps. Leverage capped low until the paper record justifies more — leverage amplifies edge AND its absence.
- **On-chain memecoins second** (harder: custody + routing + MEV) — non-custodial design per platform principles; capacity respected (~$1k positions; the edge inverts at $10k).
- Every fill graded; live slippage vs paper assumption measured; divergence → auto-downgrade back to paper.
- **Honesty clause:** "make millions" is the direction, not a promise. The memecoin edge is real but capacity-capped; majors/perps edge is UNPROVEN until Phase 5 says otherwise. The system's job is to find and compound what survives the gates.

### PHASE 7 — THE PREMIUM FACE (parallel-tracked with 2–4) — first pass ✅ SHIPPED 2026-07-06 (`f861081f`): hero READ band, proof strip (grades-v2 + desk scorecard), Idea-Book convergence cards (ENTRY/INVALIDATION/KEY LEVEL + safety), awareness hot/quiet hierarchy, board table craft, palette+day-mode tokens, dead brain-page/terminal purged (−3.5k lines). Remaining: Ask-the-Brain header input, Hunter rail (Phase 3), full P&L ledger expansion, board severity wiring.
From the design audit (full ranked list in the audit report):
7.1 Hero: render the READ (thesis + flips-if + 4 clocks + coherence) beside the Eye — `TheRead` exists as dead code; wire it. The trader's first 5 seconds = regime, stance, the read, proven %.
7.2 Credibility strip under hero: hit-rate (big mono) + n + best call + equity sparkline → expands to the P&L ledger (the future track record surface).
7.3 **Idea Book section** (evolves Convergence, not a new parallel section): `$ASSET ▲ 82` anchor, ENTRY/INVALIDATION/TARGET mono cells, lens spine, status chip (WATCHING/ACTIVE/INVALIDATED/HIT).
7.4 **Hunter rail** (right rail ≥1200px): time-ordered anomaly feed, newest pulses once.
7.5 Fix list: kill duplicate section head (27 vs 26), wire-or-remove Crypto/TradFi toggle, Ask-the-Brain header input (⌘K), awareness grid hot/quiet sorting + collapse empty domains, board table craft (header type, zebra, severity accents), one section-header component, palette discipline (lens chips → tone dot + warm-white; kill #4ade80 for tokens; ≤2 decorative hues), day-mode chip overrides, delete dead brain-page/brain-terminal/brain-constants/use-brain-data (~100KB parallel dead surface), motion: fadeInUp on scroll-in + pulse-only-changed-cells.

---

## 4. The 24/7 agent team (deployment roster — Hetzner pm2 unless noted)

| Agent/worker | Cadence | Phase | Does |
|---|---|---|---|
| `brain-desk-generator` | 10 min | 1.7 | the consciousness cycle (gather→LLM→desk output) |
| `desk-call-grader` | hourly | 1.4 | grades every desk call vs price; writes hit/miss + lessons |
| `brain-chartist` | 15 min | 2 | multi-TF chart_read blobs (TA engine, one source of truth) |
| `brain-sentiment` | 15 min | 2 | crowd-stance/breadth/mindshare/KOL fusion per asset |
| `brain-x-study` | daily | 2 | digests top X accounts + KOL clusters → conditioning note into memory |
| `brain-hunter` | 15 min | 3 | anomaly/new-listing/narrative-onset/politics-odds edge search |
| lens agents + critic + risk | per desk cycle | 4 | the debate (inside the generator, separate LLM calls) |
| `worker-paper-trader` (+brain_ideas, +HL-paper) | 5 min | 5 | validates the Idea Book with paper money |
| `hl-executor` | event | 6 | Hyperliquid order client (testnet→capped mainnet) |
| existing: grader-v2, lessons, backtester, hitrate-calibrator, momentum/rollup/convergence workers | — | — | already live; we extend, not duplicate |

---

## 5. Sequencing & ownership

- **Order:** 1 → 2 → (3 ∥ 7) → 4 → 5 → 6. Phase 7 (face) can interleave any time after 1.
- **Claude lane:** all app code; desk-core + schema + ledger (dev side); engine worker code (via SSH/PR to spectre-data-api); plan upkeep.
- **Sunny lane:** deploys that need judgment (migrations on the box, pm2 ecosystem changes, PR merges, API keys for HL testnet when we get there); eyeballing prod.
- **Traps carried forward:** worktree symlinked node_modules (`fs.strict:false`, don't commit); `-c commit.gpgsign=false`; gh token from `.env` with `env -u GH_TOKEN`; keep the desk prompt in ONE place after 1.1; deployed paper-trader truth lives on `backup/box-state-2026-07-05` — reconcile to main before editing.

## 6. Scoreboard (how we know it's working)

- Phase 1: desk hit-rate VISIBLE on the page within days of shipping (even if ugly at first — 39% macro baseline says expect humility); zero ungrounded-unit signals in output; prod desk updates every 10 min with no user traffic.
- Phase 2: convergence cards cite levels ("ETH 3,420 support, invalidates below") + a sentiment stance with breadth; scam gate has blocked ≥1 real trap.
- Phase 3: hunter surfaces ≥1 edge/week that no fixed feed carried, and its calls get graded like everyone else's.
- Phase 4-5: Idea Book live; ≥15 closed paper trades on `brain_ideas`; HL-paper agent surviving with leverage.
- Phase 6: first testnet fill; then the smallest real position that proves the pipe. Scale follows proof, never precedes it.

---

## PHASE 8 — ALWAYS REALTIME · PATTERN CONSCIOUSNESS · MACRO-POLITICS CONTEXT (planned 2026-07-06 night)

### 8.1 Realtime / low-cost / never-stale (ops) — event-driven cadence + incremental context ✅ SHIPPED 2026-07-07 (`8648d28`+`b71f6a7`): generator = 2-min SQL-only scan (pulse event fingerprints + headline-class intel obs≥2) → triggers full cycle, 15-min quiet ceiling, 3-min min gap, trigger_reason logged; per-domain sha1 incremental context (unchanged → one-line marker, 45-min full resend, truth block/prices/pulse/world_state/patterns exempt), savings logged as context_chars. + ANTI-ANCHORING quality retry (stale read >90% sim 3+ cycles while tape moved; ≥3 medium+ patterns uncited; driver-actor naming; fresh political stance unsurfaced) — single combined retry slot, outcomes in `anchoring{}` log. SLO/cost-ledger items still open.
- **Event-driven cadence**: `market_pulse` scan every 1-2 min (SQL-only, no LLM). Big event (flush/V, z-spike, headline-class intel) → TRIGGER immediate desk cycle; quiet tape → desk stretches 15-20 min. Fresher when it matters, cheaper when nothing happens.
- **Staleness SLOs**: every worker output carries generated_at; sentinel (exists) alarms at 2× expected cadence per surface; pm2 auto-restart hook on repeated SLO breach. data_health chip already surfaces it.
- **Incremental context**: hash each gather domain; unchanged domains sent as one-line "unchanged since HH:MM" → major token saver per cycle.
- **Cost ledger**: per-worker LLM token log → daily rollup on a /v1/brain/health route. 70b only for synthesis/critic/macro/ask; 8b lenses; caches stay.

### 8.2 Pattern consciousness (the milestone: it FINDS patterns)
- **Episodic memory**: embed each desk cycle's state (regime + pulse + features). New cycle retrieves top-5 most-similar past states + what happened next → "this tape looks like Jun 12 (87% similar) — then BTC +4.2% in 48h". Gradeable like everything else.
- **`brain-pattern-miner`** (weekly + on-demand): conditional hit-rates from the graded ledgers (desk calls, lens calls, hunter edges, aixbt takes) — e.g. "bull calls in risk-off hit 28% vs 61% in risk-on" → `brain_patterns` table (pattern, n, hit_rate, confidence) fed into prompts as NUMBERED lessons.
- **Lead-lag stats**: attention→price, funding→flush, breadth→runner from existing tables ("author-breadth spike leads small-cap price by ~9h, n=44, 63%").

### 8.3 Macro-politics world state (founder: "macro politics context of market all key") — ✅ SHIPPED 2026-07-07 (`8648d28`, mig 141): worker `brain-world-state` (15-min, ZERO-LLM, writes only on quantized change, diff lines logged), table `brain_world_state`, route GET /v1/brain/world (+?history). Doc: rates (Fed funds/FOMC/rate odds/chair race from prediction_markets), politics (figure stances from brain_intel w/ quotes + election/crypto-policy odds), regulatory docket, DXY+regime, stablecoin liquidity. Fed to: desk gather `world_state` (budget 1200), macro lens slice, grounding context, Ask. + the Saylor/Trump founder fixes: NAME-THE-ACTORS prompt rule + promise-vs-action contradiction rule, de-anonymized Bottom Line examples (the "someone big sold" example was being COPIED verbatim), template-echo rejection, slimNews political reservation (4 slots/48h), REGULATORY intel carve-out, mechanical actor + political-stance surfacing checks on the quality retry. VERIFIED live: Bottom Line names "Donald Trump… 'big crypto guy'" + Strategy/Grayscale/BitMine; Ask answers the Trump question.
- **`brain-macro-context` worker**: persistent versioned WORLD STATE doc — rates path (Fed funds + FOMC odds), elections/policy via Polymarket, regulatory docket from news/intel, DXY/SPX correlation regime, liquidity proxies (stablecoin supply). Updates ON CHANGE not timer; diffs logged ("Fed cut odds 62%→71% after CPI"). Feeds macro lens, Bottom Line, Ask.
- Event-time countdowns (CPI/FOMC/elections) as first-class pulse flags.

### 8.4 Design features (creative queue)
1. **Time Machine scrubber** — drag back 24h/7d; Eye + read + board replay what the brain believed (uses shipped `?at=`). Trust builder + killer demo.
2. **"Seen before" pattern cards** — episodic matches with honest n.
3. **Lens face-off board** — per-specialist hit-rate sparklines (grades accumulating now); weak lens visibly dimmed.
4. **Why drill-down** — click any idea/convergence → slide-over receipt: lens votes, intel citations, chart snapshot at call time.
5. **Brain vs aixbt scoreboard** — same grader, public comparison.
6. **Live wire** — thin hunter/intel firehose ticker under the Eye.
7. Awareness grid "No data" state seen in founder screenshot — investigate (stale feed vs localhost) before building on it.
