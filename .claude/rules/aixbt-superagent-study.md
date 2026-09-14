---
paths:
  - "apps/research/src/pages/brain/**"
  - "packages/server/agents/**"
---

# aixbt Super-Agent Study → Spectre Brain Adoption Blueprint

**Created:** 2026-07-06 (deep crawl of docs.aixbt.tech + third-party teardowns) · **Companion:** `brain-master-plan.md`
**Docs are machine-readable:** docs.aixbt.tech `/llms.txt` + `/llms-full.txt`, any page + `.mdx` = raw markdown. API `api.aixbt.tech` (OpenAPI + MCP at `/mcp`).

## The one-line answer to "how did they build a super agent that knows everything"

**Entity resolution + a reinforced fact ledger + query-time federation + mechanical output discipline.** One `project` object unifies socials/contracts (5-source resolution incl. LLM-extracted from tweets)/market metrics/intel/clusters; repeated mentions REINFORCE one fact row instead of duplicating; TVL/security/wallets are *providers* (DeFiLlama, GoPlus, DexPaprika, BubbleMaps) called at answer time under token budgets — **no proprietary wallet indexer exists**; and the "omniscient" feel is schema-enforced: ≤10-word intel headlines, one catalyst per take, citation floors (their research agent 403s rather than answer ungrounded), a documented interpretation playbook (momentum+no-intel=hype; reinforced multi-cluster intel=credible; momentum-decay+active-intel=priced-in).

## Capability map (documented)
- `/v2/projects` (+`/{id}`, `/neighbors` co-mention graph, `/top/climbing`, `/{id}/momentum` per-cluster hourly, `/{id}/rank`, `/candles`, `/metrics`)
- Project object: `spikingScore`(+24h delta), `activeScore` (0–24 coverage-hours), `climbingScore` (72h/4h buckets, author+cluster breadth rewards, concentration PENALTIES), `momentumContext` (trajectory rising/stable/decaying/new + stability labels flash<2h/fresh 2–6h/persistent 6–24h/durable 24h+), `tokens[]{chain,address,source: coingecko|dexscreener|nuvel|tweet|grok}`, embedded `signals[]` intel.
- `/v2/intel` — the fact ledger: 12 categories (FINANCIAL_EVENT, TOKEN_ECONOMICS, TECH_EVENT, MARKET_ACTIVITY, ONCHAIN_METRICS, PARTNERSHIP, TEAM_UPDATE, REGULATORY, WHALE_ACTIVITY, RISK_ALERT, VISIBILITY_EVENT, OPINION_SPECULATION); each item: ≤10-word headline, citations[] vetted non-X, observationCount, hasOfficialSource, sentiment −1..1, reinforcedAt + activity[] timeline, clusters.
- `/v2/grounding` (+history): hourly crypto+tradfi context, ~4 bullets each, PUBLIC — the shared "what's the market doing" primitive every prompt gets.
- **Time-travel:** `at=` on all analytical endpoints with hard look-ahead guards + `provenance: historical|constructed`. The whole knowledge state is backtestable.
- **Recipes:** declarative YAML pipelines — per-step `tokenBudget`, guaranteed-sample floors, projection profiles, `for:` loops; providers: aixbt native, market (DexPaprika+CoinGecko), **security (GoPlus: honeypot/mint-freeze/holder-concentration/reputation/phishing)**, **defi (DeFiLlama: TVL/fees/emissions/yields)**.
- Agents: Indigo (chat over intel+momentum+grounding), Ultraviolet (live web+X research, citation floor), MCP 15 tools, x402 USDC-payable API keys, watchlist alerts + "Observers" (fire on entering weekly top-5) + saved daily reports to TG/Discord.
- **Negative finding:** the tiered takes (top_tier/solid_setup/…) are NOT in the API — that discipline is prompt-side composition in the persona layer. And `/v2/signals` was deprecated under users.

## Pipeline (confirmed + labeled inference)
`curated tracked-X graph (~400+ KOLs, archetype-cluster-labeled) → (a) intel extractor w/ reinforcement-dedupe [merge mechanics INFERRED: embedding-sim + LLM merge] → intel store; (b) 3 attention clocks hourly (5-min since 2026-03) → project registry (multi-source CA resolution, CG metadata) → grounding summarizer hourly → ONE inference layer (recipes = budgeted context assembly) → many faces: X agent / terminal / chat / REST / MCP.`
INFERRED with evidence: fundamentals are social-derived and shallow (admitted to Kyle Samani it read no code/whitepaper — Decrypt); accuracy contested (83% claim vs ~31% peak third-party) and **aixbt does not grade itself — no outcome endpoint exists**; 2025 dashboard compromise drained ~55 ETH from the persona-coupled wallet.

## The 10 adoptions (ranked; phase-mapped in brain-master-plan.md)
1. **Entity spine** — `brain_projects` registry (project_id, xHandle, cgId, contracts[]{chain,address,source,confidence}, categories) + resolution worker (Codex/DexScreener/CG/tweet-CA per ca-match spec). Fixes Spectre's #1 recurring bug class (symbol/cg_id identity collisions: $DOT/usedot-ai, ANSEM clones). Precondition for "knows everything about any project."
2. **Reinforced intel ledger** — `brain_intel` table + extractor worker over social_mentions/kol_mentions/news: adopt the 12-category enum verbatim; dedupe-by-reinforcement; citation-or-official-source required. Desk cites intel ids, not raw chatter.
3. **Three attention clocks + stability labels** — extend momentum_scores: climbing_score (concentration penalties = our organic gate as arithmetic), active_hours, stability_label, trajectory; + `neighbors` co-mention graph.
4. **Grounding primitive** — `brain-grounding` worker (hourly, crypto+tradfi bullets) → `/v1/brain/grounding` (+history); prepended to EVERY brain LLM pass (desk, takes, RZ sentiment).
5. **Time-travel + provenance** — `?at=` on /v1/brain/desk, projects/board, momentum (snapshot rows already exist). Makes the Brain itself backtestable — replay its own knowledge state (Phase 5.3 superpower aixbt has and nobody else does).
6. **Declarative budgeted context assembly** — desk-core gather → step spec {source, params, projection, tokenBudget, guaranteeCount}. (Per-domain budgets already shipped Phase 1; formalize when lens agents split in Phase 4 — each agent's data slice = a recipe.)
7. **Provider federation** — registry inside the engine: `security.check` (GoPlus-class: honeypot/tax/holder-concentration), `defi.tvl/fees` (DeFiLlama), `market.*` — callable per-candidate mid-cycle by lenses + the hunter. This IS the scam gate + the "defillama stuff" — days of work, not months.
8. **Output discipline as schema contract** — mechanical validation on takes/convergence: headline word cap, catalyst must cite an intel id or number-with-unit, citations non-empty, comparative names a peer — reject the row otherwise (same pattern as the shipped direction-reject). Port the interpretation playbook into the prompt as pattern-rules-over-fields.
9. **One pipeline, many faces** — `/v1/brain/project/:asset/take` (PR #11) becomes THE single per-project opinion; RZ Sentiment card, board rows, future chat/social all read it. One answer everywhere.
10. **MCP + observers** — MCP server over `/v1/brain/*` (drive the Brain from Claude sessions — dev velocity + eval); Observers (alert when a project enters Brain top-5 conviction) on existing alert plumbing.

## What NOT to copy
1. No self-grading/track record (their biggest hole — grader-v2 + brain_desk_calls is OUR structural moat; never trade it for reach).
2. No validation/execution loop (they stop at commentary; our understand→thesis→paper→gated-execution chain has no counterpart).
3. Social-derived "fundamentals" (they read mentions, not code — our site/docs/GitHub crawler PRs #1160–62 is deeper; extend it).
4. Persona-over-precision + persona-wallet coupling (100 posts/day invites manipulation; the 2025 wallet drain. Brain = desk, not influencer; generation engine-side, wallets execution-side, public paths touch neither).
5. Attention without tradability gates (no depth/capacity logic — our causal recipe is the monetizable half they lack; their scores FEED it).
6. API churn/token-gating (version /v1/brain routes; skip gating).
7. The wallet-omniscience myth (it's BubbleMaps/GoPlus federation + framing — don't build a wallet indexer to match a perception federation buys in days).
