# TOOLS.md — Spectre Dev Environment

## Dev Servers
| Service | Port | Command |
|---------|------|---------|
| Research app | 5180 | `npm run dev:research` |
| Trading app | 5181 | `npm run dev:trading` |
| Express server | 3001 | `npm run dev:server` |
| Storybook | 6006 | `npm run dev:storybook` |

## Build Commands
| App | Command | Expected time |
|-----|---------|---------------|
| Research | `npm run build:research` | ~10s |
| Trading | `npm run build:trading` | ~8s |
| Shared UI | `npm run build:ui` | ~3s |

## API Keys (configured in .env)
- CODEX_API_KEY — Codex GraphQL (primary market data)
- COINGECKO_API_KEY — CoinGecko Pro (fallback market data)
- ANTHROPIC_API_KEY — Claude (Monarch AI agent, server-side)
- ZEROX_API_KEY — 0x swap
- VITE_PRIVY_APP_ID — Privy auth (frontend)

## Git Workflow
- Working branch: `prod`
- Never push directly to `main`
- PRs: `prod` → `main` via `gh pr create --base main --head prod`

## Key File Locations
- Design system: `.claude/rules/design-system.md`
- Mobile rules: `.claude/rules/mobile-design-system.md`
- Coding standards: `.claude/rules/coding-standards.md`
- Corrections log: `.claude/learning/corrections.md`
- Patterns: `.claude/learning/patterns.md`
- Backlog: `TODOS.md`

## Claude Code Integration
Spawn via coding-agent skill:
```bash
claude code --print --permission-mode bypassPermissions -p "{task}" /Users/gleb02f/Documents/spectre-app
```
