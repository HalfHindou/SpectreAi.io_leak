# Parallel Agents — Spectre AI Trading Terminal

## How Many Agents?

**8 agents.** They are roles, not separate apps:

1. Database Schema  
2. Backend API  
3. WebSocket Server  
4. Cache Layer  
5. Frontend UI  
6. Test Suite  
7. Error Handling  
8. Documentation  

They only run when the **orchestrator** in a Composer session dispatches them (via the Task tool). There are no always-on background processes.

---

## When Do Agents Actually Run?

| When | What happens |
|------|-------------------------------|
| You open Composer and type a task | Orchestrator runs → picks agent(s) → launches Task sub-agent(s) → they do the work → dashboard updates |
| You close Composer / leave | No agents are running. Nothing runs 24/7 inside Cursor. |
| You paste a prompt in a **new** Composer tab | That tab acts as that one agent for that session (manual mode). |

So: **agents work on tasks only when you (or the orchestrator in your session) start them.** Cursor is session-based; it has no daemon or “agents running in the background 24/7.”

---

## Can They Work 24/7?

**Not inside Cursor.** Cursor does not support:

- Persistent background agents  
- Headless/API-triggered Composer runs  
- A queue that Cursor polls and works through on its own  

**Ways to get “more continuous” work without true 24/7:**

1. **Task queue you process in batches**  
   Keep a list of tasks (e.g. ` .claude/tasks.md` or GitHub Issues). When you sit down to work, paste the next task(s) into Composer. The orchestrator routes each to the right agent(s). You’re the trigger; agents still run only when you’re in a session.

2. **Scheduled “work blocks”**  
   Use a calendar reminder or scheduler to open Cursor and paste one task from your list. Again, agents run only when that session is active.

3. **True 24/7 automation (outside Cursor)**  
   Use another system (e.g. cron + script, CI, or a platform with persistent AI workers) to run your code/tests or call an LLM API with the same prompts. That system runs 24/7; Cursor agents do not.

**Summary:** You have **8 agents** that run **on demand** when you give a task in Composer. To make it feel like “they work on tasks themselves,” use a task list and process it whenever you open Cursor; there is no way to make the agents themselves run 24/7 inside Cursor.

---

## How It Works Now

**You just describe the task. The orchestrator auto-routes it.**

The rule `.cursor/rules/orchestrator.mdc` is always active. When you give any task, the AI:

1. Analyzes which domain(s) your task touches
2. Picks the right agent(s) from the routing table
3. Launches them as parallel sub-agents (up to 4 at a time)
4. Merges the results and handles integration

You never need to manually pick an agent or copy a prompt.

---

## The 8 Agents

| Agent | Domain | What it handles | Files it owns |
|-------|--------|-----------------|---------------|
| **Database Schema** | database, SQL, models | PostgreSQL migrations, connection pool, CRUD models | `server/db/` |
| **Backend API** | routes, endpoints | Express route modules, input validation, API responses | `server/routes/` |
| **WebSocket Server** | real-time, pub/sub | WS server, connection manager, channels, heartbeat | `server/ws/` |
| **Cache Layer** | Redis, caching | Redis client, cache service, token/price cache, pub/sub | `server/cache/` |
| **Frontend UI** | React, hooks, components | WS client, live price/trade hooks, connection status | `src/hooks/`, `src/services/wsClient.js` |
| **Test Suite** | tests, mocks, coverage | Test setup, mocks (Redis/DB/WS), unit + integration tests | `tests/` |
| **Error Handling** | errors, logging, rate limits | Express middleware, request logger, rate limiter, ErrorBoundary | `server/middleware/`, `src/components/ErrorBoundary.*` |
| **Documentation** | docs, guides, references | API docs, WS protocol, DB schema, setup guide, architecture | `docs/` |

---

## Routing Examples

| You say | Agent(s) dispatched |
|---------|-------------------|
| "Add a /holders endpoint" | Backend API |
| "Create the database tables" | Database Schema |
| "Show live prices on the chart" | Frontend UI |
| "Add rate limiting to the API" | Error Handling |
| "Write tests for the WS server" | Test Suite |
| "Set up Redis caching for prices" | Cache Layer |
| "Build real-time trade feed end-to-end" | WebSocket Server + Frontend UI + Cache Layer |
| "Build the full real-time infrastructure" | All 8 agents (2 waves of 4) |

---

## Manual Override

If you want to run agents yourself (e.g. 8 Composer sessions for max parallelism):

1. Open `.claude/plans/realtime-websocket-prompts.md`
2. Find the stream section (e.g. `## STREAM 1: Database Schema & Models`)
3. Copy the full prompt between the `---` markers
4. Paste into a new Composer session

Full prompt file: `.claude/plans/realtime-websocket-prompts.md`

---

## File Ownership (no conflicts)

No two agents touch the same file:

```
server/db/          → Database Schema agent
server/routes/      → Backend API agent
server/ws/          → WebSocket Server agent
server/cache/       → Cache Layer agent
server/middleware/  → Error Handling agent
src/hooks/          → Frontend UI agent
src/services/       → Frontend UI agent
src/components/ErrorBoundary.* → Error Handling agent
tests/              → Test Suite agent
docs/               → Documentation agent
```

**Integration files** (`server/index.js`, `src/App.jsx`, `package.json`) are handled by the conductor (main session) after agents finish.

---

## Claude Code Agent Team (1 lead + 4 specialists)

For use with **Claude Code CLI** (not Cursor). Defined in `.claude/agents/`. Tell the **team-lead** what you want in natural language — it handles the rest.

| Agent | Domain | Files Owned |
|-------|--------|-------------|
| **team-lead** | Orchestrator — decomposes, delegates, integrates | App.jsx, main.jsx, package.json, vite.config.js |
| **frontend-panels** | Layout, nav, auth, utility UI | LeftPanel, RightPanel, Header, WelcomePage, AIAssistant, SmartMoneyPulse, AuthGate, Icon, DesignSystem (JSX + CSS) |
| **frontend-charts** | Charts, tickers, data viz, effects | TradingChart, DataTabs, TokenBanner, TokenTicker, ChainVolumeBar, ParticleBackground (JSX + CSS) |
| **data-layer** | API client, hooks, server, data utils | useCodexData.js, codexApi.js, tokenColors.js, server/index.js, api/codex.js |
| **design-system** | Global CSS, tokens, spectre-ui library | src/index.css, src/App.css, DESIGN_SYSTEM.md, packages/spectre-ui/ |

**Prerequisites:** Add `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` to `settings.json` → `env`.

**Usage:** Start Claude Code → tell the team-lead what you want → press **Shift+Tab** for delegate mode. The lead creates a shared task list, spawns specialists, and coordinates. Teammates self-claim tasks, work in parallel, and communicate via SendMessage.

All agents read `CLAUDE.md` for full project context. Agent definitions: `.claude/agents/*.md`
