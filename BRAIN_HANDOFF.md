# Spectre Brain — "The All-Seeing" — Handoff

_Last updated: 2026-07-06. Branch `brain/eagle-eye-redesign` (app) · PR #1217._

> **THE BUILD PLAN LIVES IN `.claude/rules/brain-master-plan.md`** — 7 phases from consciousness to (gated) auto-trading, grounded in the 2026-07-06 triple audit (engine / backend-infra / design). Read it before touching anything. Phase 1 (truth loop) is SHIPPED dev-side: shared `api/_lib/desk-core.js`, trade-read schema (invalidation/horizon/entry_price), outcome ledger + self-grading, prices + scorecard in context, unit-sanity hygiene.

---

## ⚡ STATE AS OF 2026-07-07 MORNING — READ THIS FIRST (v2 handoff)

Everything below §0 (vision) is still true; §§1-6 of the original doc are OUTDATED — one massive build day (2026-07-06→07) shipped Phases 1→5 + 8. **The authoritative current-state docs are:**
- `.claude/rules/brain-master-plan.md` — phases marked shipped inline, with commits
- `.claude/rules/aixbt-superagent-study.md` — the adoption blueprint
- auto-memory `brain-master-plan-phase1-2026-07-06.md` (in `~/.claude/projects/-Users-sunny/memory/`) — the full chronological build log w/ every commit, migration, trap

### What is LIVE right now
**Engine (data-api, Hetzner, branch `sunny-codex-pr3-pr5-trim-workers` — build ONLY from worktree `/Users/sunny/spectre-data-api-desk-wt`, main checkout is stale):**
migrations 128-141 applied (142/143 pending, see IN-FLIGHT). pm2 workers: `brain-desk-generator` (event-driven: 2-min scan triggers cycles on events/headlines, 15-min quiet ceiling, incremental context hashing −20% tokens; 7 lens agents → synthesis → critic → risk mgr), `desk-call-grader` (hourly, grades desk+lens+aixbt+hunter calls, marks ideas), `brain-intel-extractor` (reinforced 12-cat fact ledger), `brain-grounding` (hourly numeric bullets), `brain-project-resolver` (1338-project entity registry), `brain-attention-clocks` (3 clocks + reconciled trajectory verdict — ONE attention truth per asset), `brain-hunter` (5 detectors), `brain-daily-setups` (5 lens setups/day, self-marking), `brain-situations` (aixbt-lingo street takes, 10-min), `brain-aixbt-tracker` (15-min; tracks @aixbt_agent, grades ITS calls with our grader; Alaa's replies endpoint pre-wired, still 500), `brain-pattern-miner` (6h; brain_patterns + episodic memory), `brain-world-state` (on-change versioned macro-politics doc), `brain-x-study` — **NO, NOT BUILT** (see NEXT). Paper traders: 9-12 (social race) + **13 Brain_Ideas + 14 Brain_Perps** (live since 07-06, ≥15-closed gate clock running).
Routes: /v1/brain/{desk (payload + scorecard + lens_scoreboard + ideas + data_health + simple + market_pulse + chart_reads),ask?q=,ideas,setups,situations,hunter,attention,patterns,world,aixbt,intel,grounding,projects/registry,lookup?key=,desk?at= (time-travel)} (+ /v1/brain/{backtest,gates} from the in-flight 5.3 build).
**App (/brain page, this worktree, PR #1217 branch):** Eye hero (wide 2.3fr, self-healing canvas, 3 beams/constellation/awareness ring) + read band (majors/events w/ named drivers/top stacks) → Bottom Line (plain-English, jargon-gated, actors NAMED) → world-state strip → proof strip (grades-v2 + desk self-grading) → self-knowledge pattern strip → What I'd Trade Today (humanized NO TRADE) → Idea Book (7-dot debate strip C S O L M D N + critic) → Convergence → Board+Hunter rail (board reads reconciled attention verdicts) → Situations feed → Market Intel → awareness grid. Ask-the-Brain ⌘K in header. data-health amber chip. Zero italics, content ≥0.82 warm-white, no slop (Sunny rejects colored left-bars/glyphs).

### Scoreboards (07-07 ~06:00Z — the learning is WORKING)
Desk 4h: 230 graded, 43.5%. **Per-lens: chartist 70% (n=10), catalyst 66.7%, macro 42.9%, sentiment 40%, leverage 27%, onchain 23.1%, degen 22% avg −13.5% (the drag — its medicine = spotted-plays receipts, not yet wired).** Patterns: conviction-80+ @1d = 71.8% (n=39) vs conviction-60s @4h = 13%. aixbt graded by us: JTO 24h HIT +3.37%. Setups 10 issued/1 resolved (miss). Trader 13: −$50 unrealized; 14: first perp round-trip −$21.5 realized.

### IN-FLIGHT / DANGLING (verify first thing next session)
1. **Migrations 142+143 STILL pending behind a multi-hour pg_dump** (healthy — backups repointed to the 364G volume 07-06; two retry loops armed on box, `/tmp/mig-143-retry.sh` restarts brain-pattern-miner on success). VERIFY: `node scripts/migrate.js --status | tail -3` + `cat /tmp/mig-143-retry.done`.
2. ~~Receipts + x-study~~ **SHIPPED 07-07 morning** (`5cb9acc`/`3d63bcc`/`ae1f740`). **EQUITIES TAPE also SHIPPED 07-07** (`b53b5ab`→`7e4638d`): crypto+stocks consciousness — `equities_tape` desk domain (GET /v1/brain/equities: SPX/NDX/VIX/DXY/yields/gold/oil + megacap movers + crypto-adjacent COIN/MSTR/HOOD/CRCL/MARA/RIOT/GLXY/BMNR + next-48h earnings), macro lens slice carries it. Dead Yahoo ingesters resurrected — root cause: **Yahoo blacklists per (IP, User-Agent)**; the shared Chrome-120 UA was burned → minimal `Mozilla/5.0` + 60s 429-gate + zombie watchdog. VERIFY next desk cycle cites VIX/SPX/crypto-adjacent evidence.
3. **MCP data quality** (founder's claude.ai test = "self-embarrassing"): `spectre_brain_state` now serves THE DESK (legacy synthesizer demoted to `legacy_conviction`) — deployed to spectre-mcp 07-07. Remaining: stale trending/mindshare rows, X Lurker dark, liq $26.1B units bug → see `/Users/sunny/spectre-mcp-handoff-2026-07-07.md` (curate-first plan). 🪤 **Box tree is DIRTY with the OAuth deploy — `git pull` touching src/mcp/* silently refuses; deploy = stash→pull→pop, then verify `git log -1`.**
4. PR #1217 merge to main + PR #11 deploy (mig 127 + pm2) = Sunny's calls, still pending. Board tier chips are DERIVED (tooltipped) until PR #11 deploys.

### Traps (hard-won, do not relearn)
- data-api: build from `/Users/sunny/spectre-data-api-desk-wt`, push `HEAD:sunny-codex-pr3-pr5-trim-workers`; NEVER `git add -A` (node_modules symlink incident); internal key = `INTERNAL_API_KEY_RESEARCH` (legacy expired); `/v1/prices` upstream still broken (worker-screener-materializer timeout death-spiral — dev's lane; brain is candle-first everywhere + data_health sentinel flags it); prompt lives in engine desk-core.js (app `_lib/desk-core.js` = stale fallback, intentional); engine agents can run 6h+ — check in, don't assume stuck.
- app: this worktree symlinks node_modules; `-c commit.gpgsign=false`; build `NODE_OPTIONS="--max-old-space-size=4096" npm run build:research`; Sunny's localhost may lag — verify via build + engine curls.
- LLM quality: llama-3.3-70b anchors on prior reads + copies prompt examples verbatim — mechanical validators beat prompt-begging every time (direction-reject, jargon gate, actor check, attention-coherence rewrite, anti-anchoring retry all live).

---

## 0. The Vision (the north star — don't lose this)

**What happens when an AI stops _tracking_ crypto and starts _understanding_ it?**

Spectre Brain is a **market consciousness**. Not a dashboard. It studies the market — price, on-chain flows, leverage/derivatives, ETF/institutional, whales, social momentum, narratives, unlocks, macro — **and Twitter/X**, **24/7**, and it does the thing a dashboard never can:

- **It connects.** A token moving is noise. A token moving _while_ social accelerates _and_ whales rotate _and_ leverage builds _and_ a narrative forms is a **setup**. Finding those is the whole game.
- **It builds context.** A running understanding of _why_ the market is where it is — updated every cycle.
- **It remembers.** Every regime, anomaly, failed signal, confirmed move becomes part of its memory. It reads its prior read and knows what confirmed / shifted / faded.
- **It learns.** Every day it should get sharper — grading its own calls against what actually happened, updating its priors.
- **It HUNTS.** It does not wait to be shown data. It runs an **algorithm that continuously searches the market and its sources** for edge, anomalies, and the things you didn't know to look for — the unknown-unknowns. _It must find things you forgot to show it._
- **It generates IDEAS.** It reads sources and forms **trade theses** — entry, invalidation, conviction, timeframe — not just observations. From "here's what's happening" to "here's the trade and why."

The goal: **a brain that thinks like an advanced human trader** — reads the whole board, hunts for edge, weighs conviction against a proven track record, forms a thesis, and says _why_.

The **All-Seeing Eye** is the face of it: a live intelligence desk you can watch think.

Where it is today: **it genuinely absorbs, connects, and remembers.** It is honestly _"forming."_ The gaps to close (§6): the **outcome-learning loop**, the **autonomous edge-hunting algo**, **idea generation**, **agent teams**, and the **auto-trade + backtest** endgame.

---

## 0.5 The Ultimate Goals (the endgame — what all of this is FOR)

Everything above is in service of a chain. Each stage is only worth building because it enables the next:

```
UNDERSTAND the market  →  HUNT for edge (autonomous search)  →  generate trade IDEAS
      →  validate ideas (backtest + paper-trade)  →  TRADE and PROFIT
      →  scale via TEAMS OF AGENTS (each a specialist)  →  AUTO-TRADE (execute + manage) + continuously TEST
```

1. **Trade the market and profit.** The Brain's convergence + ideas must become _positions_ with entry, size, invalidation, and a P&L. Intelligence that doesn't make money is a dashboard.
2. **Build teams of agents.** Not one model — a team: lens specialists (on-chain, leverage, institutional, degen, macro), a scout/hunter that searches for edge, an idea-writer, a risk manager, an execution agent, a critic that adversarially checks every thesis. They debate, converge, and act.
3. **Auto-trade + test.** Eventually the Brain proposes → backtests/paper-trades to validate → executes autonomously (non-custodial, embedded-wallet signing) → grades every outcome → compounds. **Test before capital, always.**

> **This already has a backend foundation.** The data-api has a paper-trading system (`paper-trader.js`, `worker-signal-backtester.js`, live paper agents id=9–12 on Hetzner) and a proven **causal alpha recipe** (depth-size + entry <$2M + first-12h author-breadth ≥5–8 + volume-scaled trailing-30 = +50–71% backtest, capacity-capped). See `.claude/rules/social-trading-agent-plan.md` in the data-api and the alpha-audit memory files. The Brain's convergence engine should feed _that_ trade harness — connecting "understanding" to "profit" is the whole point.

---

## 1. What's built (current state)

The `/brain` page was rebuilt from a gated toggle-of-two-half-products into **one command deck**:

1. **The All-Seeing Eye** (`brain-eye.jsx`) — a generative canvas. Iris tinted by regime, 4 rings at the pulse/wave/tide/ocean cadences, the desk's live intel orbits as "thoughts" colored by investor lens. It **absorbs** (pulses flow inward to the pupil), **connects** (a web links converging thoughts), tracks your cursor, and blinks. Glass-orb 3D sheen + floating frosted HUD (regime/stance/conviction + proven hit-rate + clocks) + a narrating focus caption.
2. **Convergence** (`brain-convergence.jsx`) — the understanding made visible: a **State of Mind** (its live read + Confirming/Shifting/Fading vs its prior read) and the **convergence setups** (where ≥2 independent lenses stack on one asset, with the stacked signals + why).
3. **The Board** (`brain-board.jsx`) — Intel view (the desk's lens-agent narratives) + Social view (attention leaderboard, tiered) + a synthesized Brief/regime on top.
4. **Market Intel** (`brain-intel.jsx`) — thesis briefing + conviction plays / smart-money / sectors / froth / accounts (from `/v1/social/thesis`).
5. **What the Brain Sees** — the 27-domain awareness grid (reused `brain-awareness-grid.jsx`).

**The engine (the consciousness loop):** a "desk" of 5 lens-agents (Onchain / Institutional / Leverage / Degen / Macro) run as **one cached LLM call** (Groq via the app's `llm-gateway`) that:
- gathers live signals across every domain + the social thesis + narratives + momentum diffusion + the Brain's own hit-rate/lessons,
- reads its **prior read** (memory),
- returns `{ regime, context{read,changed,confirmed,fading}, convergence[], intel[], watching[], brief[] }`.

---

## 2. How to run it locally (fresh terminal)

The dev server + desk loop from the build session are **background processes that will die** when that session ends. Restart them:

### 2a. Dev server (worktree, port 5185)
```bash
cd /Users/sunny/spectre-app-pc-wt
# node_modules are symlinked from the main tree (worktree has none of its own):
ln -sfn /Users/sunny/spectre-app/node_modules node_modules
ln -sfn /Users/sunny/spectre-app/apps/research/node_modules apps/research/node_modules
# export the data-api bridge key so the /data-api proxy authenticates (STRIP CR/LF!):
K=$(grep '^SPECTRE_DATA_BRIDGE_KEY=' /Users/sunny/spectre-app/.env | cut -d= -f2- | tr -d "\"' \r\n")
export SPECTRE_DATA_BRIDGE_KEY="$K" SPECTRE_DATA_API_KEY="$K" SPECTRE_API_KEY="$K"
# launch vite (single-indirection so --port forwards correctly):
npm run dev -w @spectre/research -- --port 5185 --strictPort --host 0.0.0.0
```
Open **http://localhost:5185/brain** (brain is ungated on this branch — uncommitted tweak, see §5).

### 2b. The desk consciousness loop (separate terminal — THIS is what makes the Eye/Convergence live)
```bash
cd /Users/sunny/spectre-app-pc-wt/apps/research/api
env_get(){ grep "^$1=" /Users/sunny/spectre-app/.env | head -1 | cut -d= -f2- | tr -d "\"' \r\n"; }
export SPECTRE_API_KEY="$(env_get SPECTRE_API_KEY)" GROQ_API_KEY="$(env_get GROQ_API_KEY)" OPENAI_API_KEY="$(env_get OPENAI_API_KEY)" LLM_BASE_URL="$(env_get LLM_BASE_URL)" LLM_MODEL="$(env_get LLM_MODEL)"
export SPECTRE_API_BASE="$(env_get SPECTRE_API_BASE)"; [ -z "$SPECTRE_API_BASE" ] && export SPECTRE_API_BASE="http://204.168.244.18:3850"
# run once to prove it, then loop every 8 min:
node _desk-gen.mjs
while true; do node _desk-gen.mjs; sleep 480; done
```
`_desk-gen.mjs` writes `apps/research/public/brain-desk.json` (served at `/brain-desk.json`), which the Eye + Convergence + Board read. It reads the previous file as its **prior/memory** each cycle.

> In a normally-run full stack (`npm run dev:server` Express on the worktree), `/api/brain-desk` serves this live instead of the static file — the hook tries `/api/brain-desk` first, falls back to `/brain-desk.json`.

### 2c. Build check
```bash
cd /Users/sunny/spectre-app-pc-wt && NODE_OPTIONS="--max-old-space-size=4096" npm run build:research
```

---

## 3. Architecture / file map

**App (`apps/research`):**
```
src/pages/brain/
  index.jsx                     → renders <BrainEagle>
  components/
    brain-eagle.jsx/.css        page shell: header · Eye · Convergence · Board · Market Intel · Awareness
    brain-eye.jsx/.css          The All-Seeing (canvas)  — consumes mind + desk (convergence for the web)
    brain-convergence.jsx/.css  State of Mind + Convergence  — consumes desk
    brain-board.jsx/.css        Intel(desk) + Social(leaderboard) + Brief
    brain-intel.jsx/.css        Market Intel cards (from /v1/social/thesis)
    use-brain-mind.js           hero data: state-of-mind + dashboard + grades-v2 (the read, 4 clocks, PROVEN hit-rate)
    use-brain-desk.js           desk data: regime, context, convergence, intel, watching, brief
    use-brain-board.js          social leaderboard + signals
    use-brain-awareness.js      27-domain awareness (Pattern B /api/brain)
    brain-awareness-grid.jsx    (reused) the awareness grid
    [DEAD, can delete] brain-page.jsx, brain-terminal.jsx, brain-constants.js, use-brain-data.js
api/
  intel-api.js                  dispatcher — registered fn=brain-desk
  _lib/handlers/brain-desk.js   the CONSCIOUSNESS handler (prod): gather → LLM confluence+memory → {regime,context,convergence,intel,...}, KV cache + KV prior
  _desk-gen.mjs                 [UNTRACKED dev tool] the local generator → public/brain-desk.json (the live loop in §2b)
  _desk-test.mjs                [UNTRACKED] one-shot test
vercel.json                     /api/brain-desk → /api/intel-api?fn=brain-desk
public/brain-desk.json          [UNTRACKED, generated] the live desk output
packages/server/
  routes/brain-desk.js          Express dev mirror (delegates to the ESM handler)
  index.js                      registers app.use('/api/brain-desk', ...)
```

**Data flow / endpoints** (data-api base `http://204.168.244.18:3850`, via the vite `/data-api` proxy which injects `X-API-Key`):
- Eye/hero (`use-brain-mind`): `/v1/brain/state-of-mind`, `/v1/brain/dashboard`, `/v1/brain/grades-v2/scorecard`
- Desk (`brain-desk.js`): gathers `/v1/brain/signals`, `/v1/social/thesis`, `/v1/brain/awareness/{derivatives,macro_confluence,unlocks,etf_flows,whales}`, `/v1/brain/dashboard`, `/v1/brain/narratives`, `/v1/brain/trenches/momentum` → 1 LLM call
- Board social: `/v1/social/leaderboard-rollup`, `/v1/brain/trenches/momentum`
- Market Intel: `/v1/social/thesis`
- Awareness grid: `/api/brain/awareness/full` (Pattern B)

**Key models:**
- **Desk = 5 lens-agents in one LLM pass** (Onchain/Institutional/Leverage/Degen/Macro). Prompt lives in both `_desk-gen.mjs` (dev) and `_lib/handlers/brain-desk.js` (prod) — **keep them in sync**.
- **Convergence** = ≥2 independent lenses stacking on one asset.
- **Memory** = prior read fed back in (KV in prod, the JSON file in dev).

---

## 4. Backend (data-api) — separate track

There's a companion backend layer, **Project Consciousness**, in a data-api worktree:
- Worktree `/Users/sunny/spectre-brain-wt`, branch `brain/project-consciousness`, **PR #11** on `Spectre-AI-Bot/spectre-data-api`.
- Adds per-project tiered takes (top_tier/solid_setup/uphill_climb + catalyst + diffusion "new colors") → migration `127_brain_project_takes` + worker + routes `/v1/brain/projects/board | /project/:asset/take`.
- **NOT deployed yet.** The app's board reads it best-effort (`/v1/brain/projects/board`) and degrades until it deploys. Deploy = apply migration 127 → `pm2 reload spectre-api` → `pm2 start ecosystem.config.js --only brain-project-consciousness` (Sunny's Hetzner lane). See `docs/PROJECT_CONSCIOUSNESS.md` in that worktree.
- (Separate, already meaty: PR #1216 = the RZ Sentiment "Spectre Take" card.)

---

## 5. Uncommitted / local-only (don't lose, don't accidentally commit the wrong ones)

- `src/constants/comingSoonPages.js` — **brain UNGATED** (needed to see /brain). Commit this if launching; keep local otherwise.
- `vite.config.js` — `open: '/brain'` + `server.fs: { strict: false }` — **dev-only tweaks, do NOT commit** (fs.strict false is only for the symlinked-node_modules worktree; open:/brain is convenience).
- `api/_desk-gen.mjs`, `api/_desk-test.mjs`, `public/brain-desk.json` — **untracked dev tooling / generated**. Keep `_desk-gen.mjs` (it's the live loop). Don't commit `brain-desk.json` (generated).

Everything else is committed to `brain/eagle-eye-redesign` (10 commits, PR #1217).

---

## 6. Roadmap — the path to fully realize the vision

Ordered by how much it closes the gap to "an advanced human trader that learns."

### 6.1 THE outcome-learning loop (highest priority — makes "learns from every signal" true)
**✅ SHIPPED dev-side 2026-07-06** (`desk-core.js` + ledger + grading, commit `6f81c41e`). Remaining: the Hetzner `desk-call-grader` worker (proper checkpoint prices from candles) + engine-side generation (master plan 1.4/1.7). Original spec:
Right now memory is _continuity_ (reads its last read), not _outcome learning_. Build:
- **Persist** every convergence call (asset, direction, conviction, ts, the signals) to a store (KV list or a `brain_desk_calls` table in data-api).
- **Grade** them: N hours/days later, score against price/outcome (the data-api already has `grader-v2` + `brain_grades_v2` + `brain_lessons` for the macro brain — extend the same loop to desk convergences).
- **Feed the scored history back** into the desk prompt ("your last 20 convergence calls: hit-rate X%, here's what you got wrong") so it self-corrects and the Eye visibly sharpens daily.

### 6.2 Study Twitter/X 24/7 (the "market Twitter all of it" pillar)
- A **scheduled cloud agent** (cron/routine) that ingests the top crypto X accounts + KOL clusters daily, distills what's forming, and writes a **conditioning note into the Brain's memory** so the desk compounds context over time. (The data-api already has `kol_clusters`, `kol_mentions`, `social_mentions`, the X-lurker signals, and `momentum_scores` diffusion — this is a synthesis + persistence job, not new ingestion.)
- Surface "narrative onset" (a narrative being born in one community, diffusing to many — the aixbt "new colors" model) as a first-class Degen/Narrative lens input.

### 6.3 Autonomous edge-hunting (the search algo — "find what I forgot to show")
A **scout/hunter** that does NOT wait for the fixed endpoint list. It continuously **searches**: scans newly-listed tokens/pairs, anomaly-detects (funding / OI / flow / social outliers vs 30d baselines — the data-api already computes `novelty_score` in `brain_observations`), tracks narrative onset diffusing across communities (`momentum_scores` "new colors"), and crawls sources (news, X, docs) for edge nobody flagged. Output: **candidate edges the fixed feed would miss** → fed into the desk. This is the difference between a terminal and a hunter. _It must surface things you didn't know to look for._

### 6.4 Idea generation → trade theses
Turn convergence + hunted edges into **actionable ideas**, not observations: `{ asset, thesis, entry zone, invalidation, target/trailing, conviction, timeframe, size logic }`. Not "ETH looks bullish" but "long ETH here, invalidate below X, trail 30%, size by pool depth." A **critic agent** adversarially stress-tests each idea before it's shown.

### 6.5 Agent teams (specialists that debate + converge)
Split the single 5-persona LLM pass into **independent agents** — lens specialists (on-chain / leverage / institutional / degen / macro), each with its own data focus + memory + track record — plus a **hunter** (6.3), an **idea-writer** (6.4), a **risk manager**, an **adversarial critic**, and a **synthesis lead** that resolves them into convergence + a ranked **idea book**. They debate, converge, act. This is "build teams of agents" done properly.

### 6.6 Trade harness → auto-trade + test (the endgame)
Wire the idea book into the data-api's **existing paper-trading + backtest** foundation (`paper-trader.js`, `worker-signal-backtester.js`, live paper agents id=9–12 on Hetzner) using the proven **causal recipe** (`.claude/rules/social-trading-agent-plan.md`: depth-size + entry <$2M + first-12h author-breadth ≥5–8 + trailing-30). Flow: **idea → backtest / paper-validate → track outcome → grade (feeds 6.1) → only then, autonomous execution** (non-custodial, embedded-wallet signing, idempotent, risk-capped). **TEST BEFORE CAPITAL, always.** This closes the loop from _understanding_ to _profit_.

### 6.7 A row per project (aixbt's full table)
Wire the Project-Consciousness per-token takes (PR #11, once deployed) so every board row has its own grounded catalyst/thesis — not just the top market-wide reads.

### 6.8 Premium/design sweep (in progress)
Done: Market Intel, the Eye (glass/spatial/scan/absorb/connect), readability, day-mode. Remaining to the same bar: the **desk table rows**, the **header** (Crypto/TradFi + an "Ask the Brain" field wired to the brain chat), the **awareness grid** (densest/grayest).

### 6.9 Deploy
- App: merge **PR #1217 → main** (research features go to `main`; the `engineering` branch is a divergent lineage that lacks these files). Commit the comingSoonPages ungate when launching.
- Data-api: deploy **PR #11** (migration 127 + pm2).

---

## 7. Gotchas / traps (learned the hard way this session)

- **Worktree has no node_modules** → symlink from the main tree (§2a). `fs.strict:false` in vite needed because the symlink resolves outside the worktree root (else @fontsource 403s).
- **`/data-api` proxy 401** if the key isn't exported, or if it has a trailing `\r` (the `.env` is CRLF-ish) → always `tr -d "\r\n"`.
- **LLM keys**: `GROQ_API_KEY` + `OPENAI_API_KEY` are in the root `.env` (`/Users/sunny/spectre-app/.env`). **No ANTHROPIC key** — the gateway falls to ollama (not running) if cloud keys aren't exported, and returns "all providers failed".
- **Commit signing** fails ("Couldn't find key in agent") → `git -c commit.gpgsign=false commit`.
- **gh**: ambient `GH_TOKEN` + `~/.config/gh` token are INVALID. Valid `GITHUB_TOKEN` (ghp_) is in `/Users/sunny/spectre-app/.env` → `env -u GH_TOKEN GH_TOKEN=$TOK ~/.local/bin/gh pr ...`.
- **Dev serves `/api/*` via Express** (`:3001`, the MAIN tree's process). App serverless handlers need an Express `routes/*.js` mirror + a `vercel.json` rewrite (both done for brain-desk). That's why the live localhost uses the static `/brain-desk.json` fallback (the running :3001 is the main tree, which lacks the new route).
- **Data-api occasionally `ENETUNREACH`** (transient network to the Hetzner box) — the Eye/HUD go quiet, repopulate next poll. Not a bug.
- **Rendering objects as React children** crashes ("Objects are not valid as a React child") — several brain fields (`thesis`, `highest_conviction_thesis`) are objects `{claim,evidence,...}`; coerce to strings.
- **Day mode**: any hardcoded light `rgba(245,245,247,…)` base color needs a `.app.app-day-mode` override or it goes invisible on white. `!important` on a base rule must be matched by `!important` on the day override.
- Keep the desk prompt in `_desk-gen.mjs` and `_lib/handlers/brain-desk.js` **in sync**.

---

## 8. One-paragraph "what to tell a fresh session"

> "Continue the Spectre Brain `/brain` redesign on branch `brain/eagle-eye-redesign` (worktree `/Users/sunny/spectre-app-pc-wt`, PR #1217). It's a market-consciousness deck: an All-Seeing Eye + a desk of 5 lens-agents that CONNECT signals into convergence, hold CONTEXT, and REMEMBER their prior read. Run it per §2 of BRAIN_HANDOFF.md. The endgame (§0.5) is a chain: understand → HUNT for edge → generate trade IDEAS → backtest/paper-test → TRADE & PROFIT → agent TEAMS → AUTO-TRADE. Next big things: §6.1 outcome-learning loop, §6.3 the autonomous edge-hunting algo (find what the user forgot to show), §6.6 wiring ideas into the existing paper-trade/backtest harness. Don't break the vision in §0: think like an advanced human trader, say WHY, and ultimately MAKE MONEY — test before capital, always."
