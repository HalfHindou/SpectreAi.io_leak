# Spectre Terminal — Skill Bundle

Drop this bundle into your repo at `docs/skills/trading-terminal/`.

```
trading-terminal/
├── SPECTRE_TERMINAL_BUILD.md    # master spec — read first
└── agents/
    ├── terminal-shell.md           # Gate A — route + layout + header + sidebar + movers
    ├── terminal-data-layer.md      # Gate A — api client + hooks + websocket + mocks
    ├── terminal-chart.md           # Gate B — lightweight-charts candles + volume
    ├── terminal-transactions.md    # Gate B — virtualized tx table + token header card
    ├── terminal-trade-panel.md     # Gate B — buy/sell/DCA sidebar
    ├── terminal-insights.md        # Gate B — sentiment / key insights / outlook cards
    └── terminal-integration.md     # Gate C — serial wiring + acceptance tests
```

## How to use

### Step 1 — drop the files in
```bash
mkdir -p docs/skills/trading-terminal/agents
# copy files from this bundle
git add docs/skills/trading-terminal
git commit -m "docs: spectre terminal build spec + agent prompts"
```

### Step 2 — Gate A (two parallel terminals)

**Terminal 1:**
```
claude --dangerously-skip-permissions
```
Paste:
> Read `docs/skills/trading-terminal/SPECTRE_TERMINAL_BUILD.md` in full, then execute `docs/skills/trading-terminal/agents/terminal-shell.md`.

**Terminal 2 (in parallel):**
```
claude --dangerously-skip-permissions
```
Paste:
> Read `docs/skills/trading-terminal/SPECTRE_TERMINAL_BUILD.md` in full, then execute `docs/skills/trading-terminal/agents/terminal-data-layer.md`.

Wait for both to hit their stop condition and commit.

### Step 3 — Gate B (four parallel terminals)

Spin up 4 more terminals, one per agent:
- `terminal-chart.md`
- `terminal-transactions.md`
- `terminal-trade-panel.md`
- `terminal-insights.md`

Each paste pattern:
> Read `docs/skills/trading-terminal/SPECTRE_TERMINAL_BUILD.md` in full, then execute `docs/skills/trading-terminal/agents/terminal-X.md`. Existence-check first.

Let all four run to their stop conditions before moving on.

### Step 4 — Gate C (one terminal, serial)

```
claude --dangerously-skip-permissions
```
Paste:
> Read `docs/skills/trading-terminal/SPECTRE_TERMINAL_BUILD.md` in full, then execute `docs/skills/trading-terminal/agents/terminal-integration.md`. Run all 10 acceptance tests.

### Test URL
```
/terminal/sol/Hon2rHAiqkcDtUzL5gA2vjXPr7T1MPCK2UT2AHKCpump
```

## Key constraints every agent respects

- Existence-check before creating files (parallel-agent safety, per Brain incident lesson)
- Mock data first, API wire-up second — pure UI work in Gate B, no direct fetch calls outside `api/`
- No Tailwind, no Lucide, no emojis (design law)
- CSS Modules + `:root` tokens only
- TradingView Lightweight Charts for candles, `react-window` for tables
- WebSocket only, no polling
- Skeleton shimmer, never spinners
- Day mode mandatory on every surface
- Purple is earned — only primary CTA and active pill

## What the spec deliberately does NOT address

These are Phase 2 — resist the urge to build them now:
- Indicator calculations (EMA, RSI, MACD)
- Limit / DCA order execution
- Holders, Top Traders, Activity, Bubbles tabs (tab headers render, body is "Coming soon")
- Drawing tools on chart (rail renders disabled)
- Auto Buy panel (tab renders disabled)
- Mobile Capacitor wrap

The spec keeps these as named slots so Phase 2 is additive, not a rewrite.
