---
paths:
  - "packages/server/lib/agent*.js"
  - "packages/server/routes/agent*.js"
  - "apps/trading/api/agent*.js"
  - "services/order-engine/**"
---

# Spectre Agent - conditional orders + session signers runbook

**Created:** 2026-07-11
**Owner:** Gleb
**Scope:** the token-page AI copilot ("Spectre Agent") - chat lane, trade proposals, conditional orders, the Cloud Run order engine, and the Privy session-signer custody model. Plan of record: `C:\Users\worka\.claude\plans\harmonic-kindling-shannon.md`.

---

## A. Custody model (the CLAUDE.md principle #1 amendment)

Principle #1 ("wallet signing happens client-side via Privy embedded wallets only") is AMENDED for ONE surface: **conditional orders**.

- The wallet stays **user-owned**: keys live in Privy's TEE, never client-exportable to us, never server-side.
- The user grants a **revocable, policy-scoped session signer** via an explicit consent sheet (`AgentConsentSheet`): our key quorum may sign `signAndSendTransaction` ONLY for the allowlisted Solana programs (Jupiter v6 + ComputeBudget + ATA + System + Token/Token-2022 - System is required because our 90/5/5 fee transfers ride the same tx).
- Our server holds only a **P-256 authorization key** (never the wallet key). Policy denials are enforced inside the TEE.
- Revocation: `removeSigners` from the panel; the engine re-verifies `delegated:true` immediately before EVERY sign (revocation is not atomic - a tx signed in the last seconds can still land; disclosed in the consent copy).
- Marketing language: "user-owned wallet with revocable, bounded automation" - NEVER "fully non-custodial server signing".
- Immediate chat trades are UNCHANGED: propose + one-tap confirm, client-signed.

## B. Ids, keys, env

| Thing | Dev | Prod |
|---|---|---|
| Privy app | `cmrach2gi00350cjoe1pcunll` (Spectre AI Dev) | `cmmkl27iz00v80bjibo1q0ypl` (Spectre AI App) |
| Key quorum | `s7f2ew4ouvzwki3zlewhcen0` | `jnyy23ifhzvsgy6s5nfmczsv` (created 2026-07-12) |
| Solana policy | `ulj4hul1zeaism758cc3su9l` | `kh84196h48ph2fx7ga50hje2` (created 2026-07-12, identical 6-program allowlist) |
| Authorization key | `C:/Users/worka/.config/spectre-agent/privy-authorization-key-dev.pem` (P-256 PKCS8, NOT in repo; raw-key path) | **GCP KMS HSM** `projects/third-opus-411016/locations/europe-west1/keyRings/spectre-agent/cryptoKeys/prod-authorization-key/cryptoKeyVersions/1` (EC_SIGN_P256_SHA256). Engine signs via `sign_fns`->KMS when `PRIVY_KMS_KEY` set. |

Env (root `.env` for dev; trading Vercel project + Cloud Run Secret Manager for prod):
- `AGENT_MODEL` (gemini-3-flash-preview) / `AGENT_MODEL_FALLBACK` (gemini-2.5-flash) / `AGENT_DAILY_MSG_CAP` (200) / `AGENT_MAX_ROUNDS` (6)
- `GOOGLE_TTS_API_KEY` - the agent/brief voice (Chirp3-HD). **DONE 2026-07-23**: dedicated key `spectre-agent-tts` (API-restricted to texttospeech.googleapis.com, minted in Cloud Shell as info@spectrebot.ai) in root `.env` (main + trading-parallel worktree copies - they are separate files) AND trading Vercel Production env (applies on next deploy). The key path is tried BEFORE ADC, so the stale-ADC degradation (403/timeout -> silent webspeech fallback, seen 2026-07-23) is dead. Verified: `getSpeechAudio` -> `google:en-US-Chirp3-HD-Charon` OGG via the key.
- `GEMINI_API_KEY` (prod lambda) | `GOOGLE_GENAI_USE_VERTEXAI=1` + `GOOGLE_APPLICATION_CREDENTIALS` (local dev - the Gemini dev API is geo-blocked from PL; Vertex is not)
- `VITE_PRIVY_SIGNER_QUORUM_ID` / `VITE_PRIVY_SIGNER_POLICY_ID` (per Privy app - consent sheet renders disabled when absent)
- `ORDER_ENGINE_INTERNAL_KEY` (swap quote/log internal branches; Vercel env + Secret Manager)
- Engine only: `PRIVY_KMS_KEY` (prod - KMS key-version resource name; when set, engine signs via `sign_fns`->GCP KMS asymmetricSign, low-S normalized, NO raw key) OR `PRIVY_AUTHORIZATION_KEY_B64|_FILE` (dev raw-key fallback), `PRIVY_APP_ID`/`PRIVY_APP_SECRET`, `ORDER_ENGINE_KILL`, `ORDER_ENGINE_DRY_RUN`, `ORDER_ENGINE_CODEX_RPM` (2), `ORDER_ENGINE_DAILY_CAP_USD` (2000), `APP_BASE`, `STREAM_BASE`, `HELIUS_RPC_URL`, `KV_REST_API_URL`/`KV_REST_API_TOKEN`. KMS signer: `services/order-engine/src/privy.js` `kmsSignFn`/`derToLowSBase64`, tested `src/__tests__/kms-signer.test.js` (no live KMS needed). Deps `@google-cloud/kms` + `@noble/curves`.

## C. Architecture map

- Chat lane: `packages/server/lib/agent-core.js` (Gemini loop, tools, prompt, trade helpers - CJS shared brain) + `routes/agent.js` (dev) + `apps/trading/api/agent.js` (prod twin, maxDuration 60, includeFiles agent-core + llm-gateway). SSE events: meta/text/tool_start/tool_result/trade_proposal/order_ticket/error/[DONE].
- Fast path: `quote_swap{andPropose:true}` = quote + validator + confirm card in one tool round (~6s to card, measured).
- Decimals rule: NO quote is ever produced without verified decimals (digest tokenData -> snapshot; refuse otherwise). Never reintroduce a 9/18 fallback - a wrong guess missizes sells 10^(guess-real).
- Fees: `POST /api/swap/quote` is the ONLY quote source anywhere (client card, chat tool, order engine). Quoting Jupiter/0x directly skips the platform fee AND fails swap-log verification.
- Orders: `packages/server/lib/agent-orders-core.js` (validation + Upstash store: `agent:order:*`, `agent:orders:user:*`, `agent:orders:active`, `agent:inbox:*`) + CRUD twins (`routes/agent-orders.js`, `api/agent-orders.js`). Solana-only v1, <=10 open orders, spendCap <= $1000, expiry <= 30d, 409 `signer_not_granted` until delegated.
- Engine: `services/order-engine/` (standalone package, own node_modules). Price feed = stream.spectreai.io SSE -> app KV tsnap -> capped reconciler (2/min). Evaluator = 3-tick/5s wick filter + 100bps re-arm hysteresis + live-supply mcap re-derivation + top-down DCA bands. Executor gates: kill switch -> SET NX exec slot -> delegated recheck -> token-tax -> daily/spend caps -> internal quote -> impact <=5% -> TEE sign (idempotency `orderId:tranche:attempt`) -> confirm poll -> internal swap-log (`onBehalfOf`) -> inbox.
- Read-only tier: research-iframe embeds chat via the signed `x-demo-token` (capability 'read' - zero trading tools). Mutations everywhere are strictly Privy JWT.

## D. Verify (per change)

- `node packages/server/lib/__tests__/agent-core.test.mjs` (47 assertions) + `node services/order-engine/src/__tests__/evaluator.test.js` (17)
- `npm run build:trading` (check-critical-path must stay green)
- Dev SSE: `curl -N -X POST localhost:3001/api/agent/chat -H "Authorization: Bearer <jwt>" ...` streams incrementally (compression skip)
- Fee integrity: proposal `platformFeeBps` == `GET /api/fee-config`
- Order math: ticket `trigger.priceUsd` == mcapTarget / circulatingSupply

## E. Prod rollout checklist

**PROD GATE TEST PASSED 2026-07-12 (engine revision 00007-zgv).** A real $1 TRENCHER conditional order fired + executed on-chain: tx `8dwYg33dSxStGjcPTRaNPvjrTARbKxWh2ubfyQs6ReAtbS9SEmVWBwSkQduPQrNQEoS1xcxomVyWvYWKSGZCKAU` (slot 432454584, err null, filledUsd $1.0055). Verified on-chain: ONLY allowlisted programs (Jupiter v6 `JUP6Lkb`, ComputeBudget, ATA, System, Token) + 90/5/5 fee split (0.000117 / 0.000006 / 0.000006 SOL). KMS/TEE signing under the prod Solana policy = PROVEN in prod. Getting there took a 5-bug chain (see "Prod gate-test bug chain" in section F) - the headline: **all 5 Cloud Run secrets were stored WITH literal surrounding quotes** (created from quoted .env lines), so the engine's KV creds + internal key were malformed -> the engine bailed at `killSwitchOn` every tick and never processed an order on ANY revision.

**Original progress 2026-07-12 (KMS-from-the-start path chosen):** steps 1-4 DONE (KMS key, prod quorum+policy, Vercel env, **Cloud Run engine deployed + boot-validated LIVE**). Remaining = step 6 (parity curl pass, I run it), step 5 (Vercel preview parity pass). gcloud run in Google Cloud Shell as info@spectrebot.ai (local gcloud = read-only auditor SA, lacks run.services.get). "Regional Access Boundary / Gaia id not found for info@spectrebot.ai" Cloud Shell warnings are NON-FATAL noise (deploy succeeded through all of them). Engine bills ~$25-50/mo (always-on min=1).

1. **DONE 2026-07-11/12** Vercel env (trading, Production): `GEMINI_API_KEY` (2026-07-11), `ORDER_ENGINE_INTERNAL_KEY`=`_aErWdIkrmnNAHSItmWb6n69_BTyMTpCyP_P4HHYoIA` (sensitive), `VITE_PRIVY_SIGNER_QUORUM_ID`=`jnyy23ifhzvsgy6s5nfmczsv`, `VITE_PRIVY_SIGNER_POLICY_ID`=`kh84196h48ph2fx7ga50hje2` (both NOT sensitive - VITE_ = public). VITE_ vars bake at build - need a redeploy AND PR #1280 on the prod branch to take effect.
2. **DONE 2026-07-12** GCP KMS HSM key (EC_SIGN_P256_SHA256, europe-west1, keyRing `spectre-agent`) + prod Privy quorum `jnyy23ifhzvsgy6s5nfmczsv` (holds the KMS public key) + Solana policy `kh84196h48ph2fx7ga50hje2` (via REST, identical allowlist to dev). A FRESH prod app secret (`privy_app_...ckKY`) was created (Privy masks after creation). Engine KMS signer written+tested (see section B, `kmsSignFn`). PRIVY_KMS_KEY value = the cryptoKeyVersions/1 resource name in section B.
3. ~~TEE gate test on dev first~~ **DONE 2026-07-11, all 3 passed (engine live, no DRY_RUN):** (a) $1 WIF trigger order signed under policy + filled on-chain (tx U15GZ...HDzC, 90/5/5 fees exact); (b) disallowed Memo-program tx DENIED `400 policy_violation`; (c) removeSigners mid-flight -> 2 armed orders auto_cancelled at the pre-sign delegation recheck, ZERO signatures. Found+fixed 3 bugs (transient-failure retries, server-side USD->native order sizing, amount display). The gate is the same for PROD once the KMS quorum/policy exist - re-run against the prod app before enabling live orders there.
4. **DONE 2026-07-12 - Cloud Run DEPLOYED + boot-validated.** Service `spectre-order-engine`, europe-west1, min=max=1, `--no-cpu-throttling` (MANDATORY - the setInterval tick loop must run with no inbound HTTP), `--no-allow-unauthenticated`, runtime SA `spectre-order-engine-sa@third-opus-411016.iam.gserviceaccount.com` (roles cloudkms.signerVerifier on the key + secretmanager.secretAccessor on 5 secrets). URLs https://spectre-order-engine-4tzupro74a-ew.a.run.app (+ the -277369611639.europe-west1 form). LIVE (no DRY_RUN, KMS signing). Validated via logs: `engine_started` present, ZERO tick_error (prod KV reachable). Idle (armedOrders 0) until prod orders exist. 5 secrets: oe-privy-app-secret/oe-kv-url/oe-kv-token/oe-helius-url/oe-internal-key (values from trading Vercel prod env). Deploy vehicle: self-contained tarball (Dockerfile AT ROOT + engine src, no node_modules) uploaded to Cloud Shell + `bash deploy.sh` (both in scratchpad/oe-deploy/, tarball copy at `C:\Users\worka\oe-deploy.tar.gz`).
   - **Gotchas:** (a) `gcloud auth print-identity-token` FAILS for info@spectrebot.ai (the Gaia-id-not-found issue) - can't curl the private /healthz with a token; use `gcloud logging read '...service_name="spectre-order-engine"' --format="table(timestamp,jsonPayload.event,jsonPayload.error)"` instead (engine logs are jsonPayload, NOT textPayload). (b) The "Regional Access Boundary / Gaia id not found" warnings spam every gcloud call but are NON-FATAL - the deploy + all IAM grants succeeded through them. (c) Cloud Shell file upload can fail once (flaky) - retry. (d) min=max=1 CRITICAL - two engines race the exec slot (saw it with the dev dry-run stray); when the prod engine went live the LOCAL dev engine (8091) was KILLED to avoid racing on a shared KV.
   - **NEXT (go-live):** merge PR #1280 to prod -> redeploy trading (bakes VITE_ signer vars) -> step 6 parity curl pass -> step 5 prod gate test ($1 order, sign/deny/revoke against real prod) before announcing.
5. Vercel preview parity pass: curl every /api/agent* route on a preview deployment (chat SSE incremental, 401s, orders CRUD, demo tier).
6. Quote internal-key bypass deliberately NOT implemented (30/min IP cap is ample for rare executions); add only if 429s appear in engine logs.

## F. Gotchas (hard-won)

- Privy app-level settings (allowed domains) are dashboard-only; policies/key-quorums have full REST CRUD with the app secret. App-config responses cache `max-age=300` - a domain change takes up to 5 min to unbreak `frame-ancestors`.
- Windows `setup-ports.js` false-frees ports (127.0.0.1 bind succeeds when 0.0.0.0 is taken) - netstat before trusting it.
- Vercel self-fetches to gated siblings MUST forward `cookie`/`authorization`/`x-spectre-gate` (token-snapshot.js pattern) or they 401 in prod only.
- `@privy-io/node`: `privy.wallets().solana().signAndSendTransaction(walletId, { caip2, transaction, authorization_context: { authorization_private_keys: [b64Pkcs8NoPem] }, idempotency_key })`.
- The Codex/CG change fields are mixed units - digest normalizes via the fmtChange heuristic (ratio when |v| <= 1); never blanket-x100.
- Engine fail-closed: KV unreachable = no execution; `agent:killswitch` KV + `ORDER_ENGINE_KILL` env both halt within one tick.

## G. Prod gate-test bug chain (2026-07-12) - all fixed, but read before touching the price/exec path

The dev gate test passed 2026-07-11, but the FIRST prod order sat armed for hours. Five separate bugs, in the order found:

1. **token-snapshot didn't forward its internal key to the Codex self-fetch.** The engine reaches `/api/token-snapshot` with `x-spectre-internal` and passes its gate, but token-snapshot then self-fetched `/api/codex?action=details` forwarding only cookie/auth (not the internal key) -> Codex 401 -> `details:null` -> engine had no price. Fix (PR #1282): forward `x-spectre-internal` to the sibling fetches + honor the bypass in `codex.js` (the `_engineInternal` branch, light per-IP rate limit).
2. **The 4-member assembly's 4s per-member timeout killed the cold Codex fetch for UNTRACKED tokens.** A token not in the KV snap / Hetzner tiers falls to Codex `filterTokens` (~2-5s) and blows the 4s ceiling. Fix (PR #1283): for the `engineInternal` caller, token-snapshot SHORT-CIRCUITS to a direct `/api/codex?action=details` read (9s budget, no assembly, no tsnap cache).
3. **The self-fetch used `getSelfBase()` = `VERCEL_URL` (deployment URL), which returns null; the public alias works.** Fix (PR #1284): use `https://${req.headers.host}` (the alias the engine called). An internal-only `_dbg{base,status,err}` field on the engineInternal response makes this diagnosable in one curl.
4. **THE BIG ONE: all 5 Cloud Run secrets were stored WITH literal surrounding double-quotes** (`oe-kv-url` = `"https://..."`, len 42 not 40; `oe-kv-token` len 64 not 62; `oe-internal-key` too). Created from quoted `.env` lines (the ".env values quoted -> strip when sourcing" gotcha, at the SECRET level). The engine read malformed KV creds -> every `kvCmd` threw -> `killSwitchOn` fail-closed returned true -> **every tick bailed before doing anything, on EVERY revision.** "No `tick_error`" did NOT mean healthy - the early return is clean. Fix: re-store each secret stripped (`V="${V%\"}"; V="${V#\"}"`), then restart. **Always verify secret VALUES have no wrapping quotes** (`gcloud secrets versions access ... | head -c1` should not be `"`).
5. **The executor's SOL-price fetch (`nativePriceUsd`, executor.js) and token-tax fetch were UNAUTHENTICATED** -> `/api/tokens/prices?symbols=SOL` (-> `/api/codex?action=prices`, gated) 401'd -> null SOL price -> the `native_price_unavailable` guard blocked EVERY order (can't USD-value the trade for the caps). The order fires in the evaluator, guard_blocks, then sticks at `rearmed=false` (won't re-fire until price recrosses REARM_BPS out of zone). Fix: send `x-spectre-internal` on both GETs (Codex already honors it).

**Observability lesson:** `gcloud logging read` AND `gcloud auth print-identity-token` both FAIL for `info@spectrebot.ai` (Gaia-id-not-found) - can't read Cloud Run logs or curl the private `/healthz` with a token. The engine now writes a **KV heartbeat** (`agent:engine:health`, EX 120s) every tick: `{armedCount, evalSnap:[{price the engine saw, trigger, fire, reason}], watched, reconcilerLastMin, sseConnected, lastError}`. Read it with `GET agent:engine:health` - this is the ONLY reliable window into the running engine. `/healthz` temp-public trick: describe's `status.url` (`...4tzupro74a-ew`) returns a Google 404; the WORKING url is the project-number form `https://spectre-order-engine-277369611639.europe-west1.run.app`.

**Engine redeploy vehicle:** `scratchpad/oe-deploy/` (Dockerfile at root + services/order-engine/src + packages/server/lib/agent-orders-core.js + deploy.sh), tar to `C:\Users\worka\oe-deploy.tar.gz` (use the MSYS path `/c/Users/...` - tar reads `C:` as a remote host). Upload to Cloud Shell, `tar xzf`, `cd oe-deploy && bash deploy.sh`. A light restart (no rebuild) that still re-resolves `:latest` secrets = `gcloud run services update spectre-order-engine --region=europe-west1 --update-env-vars OE_RESTART=$(date +%s)`. Engine changes still local (heartbeat in index.js/store.js, executor internal-key fix) - land on main for the record.
