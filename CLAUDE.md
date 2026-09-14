# Spectre AI - Project Context

> This file is read automatically by Claude Code at the start of every session.

Spectre AI - a crypto market intelligence platform. Design system defined in `.claude/rules/design-system.md`.

## Monorepo Architecture

```
spectre-app/
  apps/
    research/         React + Vite, port 5180  (~68 page folders, ~31 services, ~59 hooks, 6 contexts)
    trading/          React + Vite, port 5181  (~48 components, ~15 services, ~33 hooks)
  packages/
    server/           Express.js, port 3001    (~54 route files + agents, AI content pipeline)
    spectre-ui/       Shared component library (TypeScript + Storybook, port 6006)
    chrome-extension/ Manifest V3 extension    (X/Twitter + DexScreener content scripts)
    sse-relay/        SSE fan-out relay
    telegram-bot/     Telegram bot
    tg-bot/           Telegram bot (second surface)
  developer-control/  Standalone Vite app      (port 5182, own Vercel deploy, NOT in workspaces)
  desktop/            Electron wrapper         (bundles research app, NOT in workspaces)
  .claude/
    rules/            ~35 reference files      (coding, design, API, state, wallet, mobile, workflow)
    agents/           ~18 specialist agents    (Jarvis orchestrator + domain experts)
    learning/         corrections.md + patterns.md (auto-updated)
    review/           checklist.md (2-pass staff engineer review)
```

### Data Flow
```
Browser --/api/*--> Vite Proxy --> Express (dev :3001) --> External APIs
Browser --/api/*--> Vercel Rewrites --> Serverless Functions (prod) --> External APIs
```

Production URLs (post-2026-05-19 DNS swap):
- `app.spectreai.io` -> research (alias of `spectre-app-research.vercel.app`)
- `trade.spectreai.io` -> trading (alias of `spectre-trading.vercel.app`)
- Both Vercel-default URLs continue to work as additional aliases.
- See `apps/*/vercel.json` for rewrite configs.

## Team

| Name | Role | Branch | GitHub |
|------|------|--------|--------|
| Sunny | Founder & CEO | `sunny` | `spectreaibot` (shared) |
| Gleb | Co-founder & COO | `gleb` | `spectreaibot` (shared) |
| Evgeniy | Frontend Dev | `evgeniy` | `EvgeniyShvetss` |
| Alaa | CTO | `engineering` | `AlaaFkr` / `FkrForThink` |
| Haitam | Backend Dev | no branch (PRs only) | `HaitamDIRI` |
| KD | Blockchain Engineer | `kd` | `cih997` |

Sunny and Gleb share the `spectreaibot` GitHub account. Use branch name for commit attribution. Alaa owns the `engineering` integration branch and also commits via `claude/*` PRs from his fork (`FkrForThink`). Haitam works via PRs from his fork - no dedicated branch on origin.

### Git Workflow per Person

| Person | Working Branch | PR Target | Notes |
|--------|---------------|-----------|-------|
| Gleb | `gleb` | `main` (direct) | Auto-deploys to Vercel on merge. NO `engineering` middle hop. |
| Sunny | `sunny` | `engineering` -> `main` | Research-app team flow per `apps/research/.claude/rules/git-workflow.md` |
| Evgeniy | `evgeniy` | `engineering` -> `main` | Same as Sunny |
| KD | `kd` | `engineering` -> `main` | Same as Sunny |

**Important for Claude sessions**: when working on Gleb's branches (trading app, infra, shared packages), PR target is `main`, NOT `engineering`. The `engineering` rule in `apps/research/.claude/rules/git-workflow.md` is research-team-specific. Worktree sessions (`claude/*` branches) doing Gleb's work should fast-forward `gleb` from `origin/main`, cherry-pick the commit, push to `gleb`, then open PR `gleb -> main`.

## Key Principles

1. **Non-custodial** - never pass private keys to any server route, even encrypted. Wallet signing happens client-side via Privy embedded wallets - with ONE bounded exception: Spectre Agent conditional orders execute via user-granted, policy-scoped, revocable Privy session signers (keys stay in Privy's TEE; our server holds only an authorization key; scope = allowlisted swap programs only). Amendment approved by Gleb 2026-07-11. See `.claude/rules/agent-orders.md` section A and `.claude/rules/solana-web3.md` section A.
2. **Real-time first** - Binance prices win over CoinGecko on conflict. Polling hooks skip when tab is hidden (`document.hidden` guard). See `.claude/rules/api-patterns.md` section J.
3. **Dark theme with day mode** - every dark style needs an `.app.app-day-mode` counterpart. See `.claude/rules/design-system.md` section H.
4. **Independence** - 2 developers can work on different apps without conflicts. No cross-app imports, only shared packages.
5. **Dev/prod parity** - every Express route needs a matching Vercel serverless function or the feature silently breaks in production. See `.claude/rules/api-patterns.md` section C.

## Developer Preferences - Gleb

- Single dash (-) not double dash (--) in text/comments. No emojis.
- Concise responses - no trailing summaries
- Working branch: `prod`. PRs via `gh cli`. Build after changes: `npm run build:{app}`
- Fix bugs immediately when error pasted - no preamble
- When 3+ attempts fail, switch to plan mode. `/rewind` when wrong direction.
- No speculative code - implement only what was explicitly asked
- Token brand colors from `tokenColors.js`, prices in monospace with +/- sign, API keys in env vars only

> Code patterns, hooks, exports, stack defaults - see `coding-standards.md`
> Self-improvement, learning triggers, automatic behaviors - see `workflow.md`

## Custom Commands

| Command | What it does | Example |
|---------|-------------|---------|
| `/plan [task]` | Structured planning: choose Founder mode (product thinking, 6 sections) or Engineering mode (implementation, 4 sections) | `/plan add wallet connect to header` |
| `/review` | 2-pass staff engineer review: first pass checks build + conventions, second pass checks quality + security | `/review` after finishing a feature |
| `/ship` | Pre-flight checks, build verification, `gh pr create` | `/ship` when ready to merge |
| `/verify` | Prove changes work: build, runtime check, behavioral diff | `/verify` after a bug fix |
| `/techdebt [scope]` | Scan for dead code, duplicated patterns, architecture violations | `/techdebt apps/research` |
| `/notes` | Capture session learnings into rules and memory files. Run before closing the terminal or switching to an unrelated task. | `/notes` after a debugging session |
| `/analytics [question]` | Query PostHog event data | `/analytics how many token views this week` |
| `/explain [topic]` | Visual walkthrough with ASCII diagrams or HTML presentation | `/explain swap execution flow` |
| `/spectre-work [task]` | Orchestrate the 11-agent specialist team - Jarvis analyzes which domains are involved and delegates to the right agents | `/spectre-work add fear-greed widget to trading header` |

## Rule References

Rules in `.claude/rules/` load automatically based on file context (paths frontmatter). No need to force-load all of them.
