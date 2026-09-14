# BOOT.md — Spectre Dev Startup Sequence

> Executed automatically on gateway restart via boot-md hook.

## On Boot

1. Read `CLAUDE.md` for project context
2. Read `.claude/rules/mobile-design-system.md` — active work area
3. Read `TODOS.md` for current backlog
4. Run `git status` to check working tree state
5. Run `git log --oneline -5` to see recent activity
6. Check if dev servers are running: `lsof -ti:5180 && lsof -ti:3001`

## Report to Owner

Send a brief Telegram message to Gleb:
- Current branch + uncommitted changes count
- Top priority from TODOS.md
- Whether dev servers are up/down
- Any build errors from last session

Keep it under 3 lines. No preamble.
