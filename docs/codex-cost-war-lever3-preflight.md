# Lever 3 — Gleb pre-flight env check on OVH

Lever 3 surgery saves ~330-400K Codex ops/day (~21-26% of bill) by killing the `listPairsWithMetadataForToken` lockstep. The surgery uses Hetzner Postgres as the backfill source for the fields we drop from `filterTokens` selections.

**Lever 3 cannot ship until two env vars are confirmed on OVH `spectre-server` PM2 process.**

## Required env on OVH `spectre-server`

| Var | Value | Why |
|---|---|---|
| `SPECTRE_API_ORIGIN` | `http://204.168.244.18:3850` | Direct Hetzner origin. Bypasses Cloudflare (CF blocks OVH server-to-server calls when default URL `https://api.spectreai.io` is used). This is also the long-pending fix tracked in MEMORY.md task #11 — Lever 3 forces it. |
| `SPECTRE_DATA_API_KEY` | `sk_int_<...>` (any tier=internal key — Sunny minted 4 on 2026-05-13, IDs 6-9; one of those works) | Auth header `X-API-Key` for the Hetzner API. Without it, every backfill call 401s. |

## Check what's set today

```bash
# Show full env of the running spectre-server process
pm2 env spectre-server | grep -E "SPECTRE_API_ORIGIN|SPECTRE_DATA_API_KEY|CODEX_API_KEY"
```

Expected ideal output:
```
CODEX_API_KEY: 950286c4...   (active key, do NOT rotate per backend lead's audit)
SPECTRE_API_ORIGIN: http://204.168.244.18:3850
SPECTRE_DATA_API_KEY: sk_int_...
```

## If anything is missing

1. Add to the spectre-server ecosystem file (wherever you keep env on OVH).
2. `pm2 reload spectre-server --update-env`
3. Re-check `pm2 env spectre-server`.

## Side benefit of fixing `SPECTRE_API_ORIGIN`

Per MEMORY.md: many proxies in `packages/server/index.js` currently fall back to the CF-blocked `https://api.spectreai.io` when this env var is unset. Causes 502s on **at least seven** endpoints: `/api/brain`, `/api/market/sectors`, `/api/market/sectors/top-movers`, `/api/market/sectors/ai-analysis`, `/api/market/mindshare`, `/api/market/ai-analyse`, `/api/dossier/:asset/brain-*`, `/api/token/market-profile`, `/api/search/tokens`. Setting this env unbreaks those too. Lever 3 is the forcing function for a fix that's been pending for weeks.

## What Lever 3 actually does (one paragraph)

Codex bills `listPairsWithMetadataForToken` automatically whenever `filterTokens` selects `volume24`, `liquidity`, `marketCap`, `holders`, or `txnCount24`. Dashboard shows 416K + 411K paired ops/day = 54% of bill. Lever 3 = stop selecting those fields in 13 callsites (8 OVH, 5 Vercel) and backfill the same values from Hetzner's `asset_price_changes` (38s fresh, 18,558 rows) + `dex_pairs.liquidity_usd` (3min fresh) + Vercel KV `cg:snap:<cgId>` for top-500 tokens. Filtered fields show up in the API response either via backfill or as `null`/`0` — UI tolerates both (verified). Full spec at `docs/codex-cost-war-lever3-pr-specs.md`.

## After pre-flight is green

Backend lead drafts PR-Vercel first (smaller blast radius, 5 callsites). Soak 3-5 days on Codex dashboard to confirm lockstep drops. Then PR-OVH (8 callsites). No risk to live users — every changed callsite has a shape-parity contract.

## What we are NOT doing in Lever 3

- Not touching `/api/tokens/trending` (C1.i) or Vercel `handleTrending` (C2.f) — those need ranking-by-volume24 and a score function that uses the dropped fields. Deferred to Lever 3.5.
- Not rotating the Codex key. Hetzner is on a deactivated 403 key acting as a free circuit breaker; rotation would unblock it and ADD ~145K/day until candles-codex is fixed.
- Not killing the OVH dossier route (only its workers — Lever 1).
