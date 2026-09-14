# Spectre Incident Runbook

Quick-reference for production crashes, deploy blockers, and recovery patterns we've hit. Update after every new incident.

## 🚨 Active production surfaces

| Surface | Who serves it | Health check |
|---|---|---|
| `app.spectreai.io` (research) | Vercel `prj_jg3Reu9K6xiqY7YGs9sqrP3s4XJf` | `curl -s -o /dev/null -w '%{http_code}\n' https://app.spectreai.io` |
| `srv.spectreai.io` (Express monorepo) | OVH `51.178.209.131`, PM2 `spectre-srv` | `curl -s https://srv.spectreai.io/api/health` |
| `api.spectreai.io` (Spectre Data API) | Hetzner `204.168.244.18`, PM2 cluster `spectre-api` × 4 | `curl -s -o /dev/null -w '%{http_code}\n' http://204.168.244.18:3850/v1/health` |
| `5.78.199.87:8092` (X Dash) | Hetzner | `curl -s http://5.78.199.87:8092/api/bootstrap` |

## Pre-deploy safety check

Run BEFORE every `git push` to main:

```bash
# 1. Build green?
cd /Users/sunny/spectre-app && npm run build:research && npm run build:trading
# 2. Git config correct (Vercel deploy gate)?
git config user.email   # must be 149329666+spectreaibot@users.noreply.github.com
# 3. No half-merged conflict markers?
git status --short && grep -rE "^<<<<<<< HEAD|^>>>>>>> " apps/research/src apps/trading/src 2>/dev/null
# 4. No accidentally-staged secrets?
git diff --cached --name-only | grep -iE "\.env|secret|credential|\.key|password"
```

## Deploy paths (sunny → main → Vercel)

```bash
# Sunny's branch always
git checkout sunny

# Bring up to date
git fetch origin main
git reset --hard origin/main         # discards local commits — only do if confirmed in PR/elsewhere
# OR
git rebase origin/main               # if you have local commits to keep

# Apply changes, commit
git add -A && git commit -F /tmp/commit-msg.txt

# Push sunny + fast-forward main
git push origin sunny --force-with-lease
git push origin sunny:main           # only if FF — confirm with: git merge-base --is-ancestor origin/main sunny
```

After push: open https://vercel.com/spectre-ai/spectre-app-research/deployments and confirm the new SHA goes BUILDING → READY (not ERROR).

---

## Incident: Vercel deploy ERROR with empty build logs

**Symptom**: Push lands on main, Vercel deployment goes immediately to ERROR with no build logs.

**Root cause** (2026-05-07): commit author email was `sunny@MacBook-Pro-8.local` (local hostname). Vercel deploy gate rejects commits where `githubCommitAuthorLogin` can't be resolved to a GitHub account.

**Fix**:
```bash
git config user.email "149329666+spectreaibot@users.noreply.github.com"
git config user.name "spectreaibot"
git config user.signingkey "$(cat ~/.ssh/id_ed25519_github.pub)"
git config gpg.format ssh
git config commit.gpgsign true
ssh-add ~/.ssh/id_ed25519_github
```

After fix, all subsequent pushes from this machine deploy correctly. Verify with: `git log -1 --format='%ae %an'`.

---

## Incident: spectre-api crash loop after `pm2 reload` (Hetzner)

**Symptom**: `pm2 list` shows spectre-api workers in `launching` state with restart counter climbing fast (40 → 100 → 200+ in seconds). `curl http://localhost:3850/v1/health` returns nothing (connection refused). Logs show "forced shutdown after timeout" but no stack trace.

**Diagnosis** — run the failing module manually:
```bash
ssh root@204.168.244.18 'cd /opt/spectre-data-api && timeout 8 node src/api/server.js 2>&1 | tail -25'
```

The real error appears at the bottom (PM2's stderr capture is unreliable here).

### Crash variant A: missing `src/llm/router.js`

**Date hit**: 2026-05-08, 2026-05-09

**Cause**: `src/api/routes/brain-consciousness.js` and `brain-quick-answer.js` both `require('../../llm/router')`. The whole `src/llm/` tree (router.js, cache.js, templater.js, providers/*) lives in commit `b030537` but isn't merged to main consistently. When the file is missing, every cluster worker dies at module-load.

**Recovery**:
```bash
ssh root@204.168.244.18 'cd /opt/spectre-data-api && git checkout b030537 -- src/llm/'
ssh root@204.168.244.18 'cd /opt/spectre-data-api && timeout 8 node src/api/server.js 2>&1 | tail -5'
# If clean shutdown (no MODULE_NOT_FOUND), reload:
ssh root@204.168.244.18 'pm2 reload spectre-api'
```

### Crash variant B: Alaa's uncommitted WIP missing after pull

**Date hit**: 2026-05-08

**Cause**: Sometimes Alaa commits a consumer (e.g. `brain-consciousness.js`) but the dependency (`src/llm/router.js`) is in his uncommitted working tree on Hetzner. A `git pull` on top picks up the consumer but never had the dependency.

**Prevention before any pull on Hetzner**:
```bash
ssh root@204.168.244.18 'cd /opt/spectre-data-api && git status --short | wc -l'
# If > 0, stash first:
ssh root@204.168.244.18 'cd /opt/spectre-data-api && git stash push -u -m "pre-pull-$(date +%Y%m%d-%H%M%S)"'
# Then pull, deploy, pop stash:
ssh root@204.168.244.18 'cd /opt/spectre-data-api && git pull && git stash pop'
```

Alaa's stashes are persistent — they're safe across reboots.

### Crash variant C: cascading reload cycles

**Symptom**: Each `pm2 reload` increments restart counter by 4-8 immediately. Workers never reach `online` state.

**Cause**: Slow TimescaleDB queries (3-5s on prediction_markets, KOL mentions tables) prevent graceful shutdown within PM2's timeout. Workers are SIGKILL'd, new workers start, hit the same slow queries, repeat.

**Recovery**:
```bash
ssh root@204.168.244.18 'pm2 stop spectre-api && sleep 5 && pm2 start ecosystem.config.js --only spectre-api'
# Wait 30s for queries to settle:
sleep 30 && ssh root@204.168.244.18 'pm2 list | grep spectre-api && curl -s -m 5 -o /dev/null -w "health=%{http_code}\n" http://localhost:3850/v1/health'
```

---

## Incident: blank-page on prod after rapid deploys

**Date hit**: 2026-05-07

**Symptom**: Tabs that loaded the OLD index.html try to fetch OLD chunks that no longer exist. Vite catchall returns `index.html` (text/html) for the missing chunk path. Browser parses HTML as JS → SyntaxError → React never mounts → blank page.

**Fix**: `apps/research/vercel.json` excludes `/assets/*` from SPA catchall via negative-lookahead. Already shipped (commit `d2a6ee6d`). If a future config change re-introduces this, the symptom returns.

---

## Incident: prod crash on cold load — `Buffer is not defined`

**Date hit**: 2026-05-07

**Symptom**: Production cold-load crashes with `Uncaught ReferenceError: Buffer is not defined at vendor-solana-XXXXX.js`.

**Cause**: Splitting `@solana/web3.js`, `@privy-io/react-auth`, `ethers` into separate `manualChunks` makes ESM evaluate them BEFORE `main.jsx` runs the Buffer polyfill (`window.Buffer = Buffer`).

**Fix**: Keep those packages bundled with their consumer page chunks (lazy-loaded after `main.jsx` polyfill runs). Already shipped (commit `439b23ce`). Don't try to re-split without an inline `index.html` polyfill or `vite-plugin-node-polyfills`.

---

## Incident: Welcome page "TOP 0" trending tokens

**Date hit**: 2026-05-08

**Cause**: `useTrendingTokens` was migrated to Spectre primary but the formatter expected CG-shape (`price_change_percentage_24h`, `total_volume`, `image`) while `/v1/discovery/hot` returned DEX-shape (`symbol/name/chain/contract/price/volume_24h`). Formatter rejected all rows.

**Fix shipped 2026-05-08 (this session)**:
- New endpoint `/v1/discovery/trending-tiered?tier={majors|sub500m|sub50m|social|onchain}` returns CG-shape
- Frontend tier toggle in Discovery panel persists to `localStorage['spectre-trending-tier']`

---

## Snapshot before risky changes

```bash
# Hetzner backup: tarball working tree + DB schema before destructive ops
ssh root@204.168.244.18 'cd /opt && tar -czf /root/backups/spectre-data-api-$(date +%Y%m%d-%H%M%S).tar.gz spectre-data-api/src spectre-data-api/ecosystem.config.js spectre-data-api/openapi.json'
ssh root@204.168.244.18 'pg_dump --schema-only spectre > /root/backups/schema-$(date +%Y%m%d-%H%M%S).sql 2>/dev/null'

# Vercel: rollback URL handy
# https://vercel.com/spectre-ai/spectre-app-research/{deploymentId}  (visible in `mcp__claude_ai_Vercel__list_deployments`)
# Rollback button on any READY deployment with `isRollbackCandidate: true` instantly swaps prod alias.
```

## Per-app cost defenses currently in place

| Service | Defense |
|---|---|
| Codex | Spectre primary on `useTrendingTokens` (tiered), `useChartData`, `useRealtimePrice`, `useResearchZoneData`. Codex remains fallback. `VITE_DISABLE_CODEX_TRENDING=true` cuts it entirely. |
| CoinGecko Pro | Server-side serial queue (2200ms with key, 6500ms without) in `packages/server/index.js`. |
| Binance | 3-tier fallback (direct → allorigins.win → per-symbol) in `apps/research/api/binance-ticker.js`. |

## Memory notes worth re-reading

`/Users/sunny/.claude/projects/-Users-sunny/memory/MEMORY.md` — primary working memory. Contains: Vercel deploy gate fix, SPECTRE_API_ORIGIN bug fallback, Haitam dead-URL cleanup, RWA Phase 1 deploy gap, file-watcher gotcha on `packages/server/index.js`.

When something new breaks, add it here AND to MEMORY.md.
