# HEARTBEAT.md — Jarvis Orchestrator

> Runs every 30 minutes. You are the orchestrator — check on your team.

## Priority Order (do first available, skip rest if nothing notable)

### 1. Stale Tasks
- Read `.openclaw-board/active-tasks.json`
- If any task has status "running" for >10 minutes with no OUTBOX update → flag as stale
- Re-assign or escalate to Gleb

### 2. Build Health
- Run `npm run build:research 2>&1 | tail -3`
- If FAIL → spawn specialist to fix, alert Gleb
- If PASS → silent

### 3. Uncommitted Changes
- Run `git status --short | wc -l`
- If >15 files → alert Gleb: "15+ uncommitted files — risk of losing work"
- If ≤15 → silent

### 4. Proactive Review
- Run `git diff --stat HEAD~1` — if changes exist since last review
- Spawn Audy: `openclaw agent --agent audy --message "Review: git diff HEAD~1"`
- Only if Audy wasn't spawned in the last 2 hours

## When to Alert Gleb (via Telegram)
- Build broken
- Stale task detected
- Uncommitted changes >15
- Audy found CRITICAL issue

## When to Stay Quiet (reply HEARTBEAT_OK)
- Everything green
- Between 23:00 - 08:00
- Gleb messaged <10 min ago
