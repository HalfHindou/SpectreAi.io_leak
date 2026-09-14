## Gleb — 60-second OVH ask: kill dossier worker bleed (Lever 1)

**Why this matters:** Codex API bill is burning ~1.55M ops/day (vs 1M/mo plan ceiling). The OVH `spectre-server` dossier workers are firing ~78K errored Codex calls/day with a deprecated `filterTokens(filters:{network:[…]})` shape — every call rejected by Codex schema but billed anyway. ~5% of the bill, 100% waste.

**The fix:** add ONE env var to `spectre-server`. Don't touch `DOSSIER_ENABLED` — that would kill the `/api/dossier/*` route and break trading-app UI.

**The flag:**
```
DOSSIER_WORKERS_ENABLED=false
```

This is already supported by `packages/server/src/dossier/index.js` on OVH (the file rsync never deleted). The gate is at the `startWorkers()` call — `brain.start()` runs first, then if `DOSSIER_WORKERS_ENABLED=false` the 7 scheduler jobs (warmup, market, scanner, safety, socials-lore, flows, project-meta, brain-signals) all skip. Route + SQLite reads keep working.

**Steps (whatever PM2 flow you prefer):**
1. Add `DOSSIER_WORKERS_ENABLED=false` to the `spectre-server` env (ecosystem file, `.env`, or wherever you keep it on OVH).
2. `pm2 reload spectre-server --update-env`

**Verify (3 checks, ~30 seconds total):**
```bash
# 1. Log line confirms the flag landed
pm2 logs spectre-server --lines 30 --nostream | grep -i "workers disabled"
# Expect: [dossier] workers disabled via DOSSIER_WORKERS_ENABLED=false — Brain still subscribed for on-demand traffic

# 2. /api/dossier/health still 200 (route is alive)
curl -s https://srv.spectreai.io/api/dossier/health | jq '.ok, .counts'
# Expect: true + the counts object

# 3. Open trade.spectreai.io, click any token, confirm dossier card still renders.
#    Data will be slightly staler than before (workers no longer refreshing), but renders.
```

**Rollback (if anything looks off):**
```
# Unset DOSSIER_WORKERS_ENABLED (or set true), then:
pm2 reload spectre-server --update-env
```

30 seconds back to current state. No code rolled back, no deploy needed.

**What we're NOT doing yet:**
- Not touching `DOSSIER_ENABLED` (would break the trading-app dossier route)
- Not migrating trading-app callers to `/api/dossier-proxy` (separate frontend task, Lever 1 doesn't need it)
- Not deploying any code change (PM2 env-only flip)

**Audit trail:** full diagnosis in `docs/codex-cost-war-HANDOFF-2026-06-02-evening.md`. Sunny's call: kill workers now, save the bigger candles + filterTokens surgery for tomorrow.
