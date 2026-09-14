# Spectre App Security

Last reviewed: 2026-05-11 (post-ShinyHunters breach lockdown)

## Auth-Gate Cookie

The team gate is now an HTTP-only signed cookie, **not** a sessionStorage flag.

- Login: `POST /api/auth-gate` with `{ password }`. On match, server sets
  `spectre-gate=<HMAC(timestamp)>; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`.
- Verify: `GET /api/auth-gate?action=check` returns 200 if cookie is valid, 401 if not.
- HMAC secret derives from `TEAM_GATE_PASSWORD` (or `AUTH_GATE_SECRET` if set).
  Attackers don't know the password so they can't forge the MAC.
- Brute-force: rate-limited to 5 attempts per 15 minutes per IP via Vercel KV.

Both apps ship their own copy (`apps/research/api/auth-gate.js` and
`apps/trading/api/auth-gate.js`) because Vercel doesn't share modules across
project boundaries. Both export `isAuthGateValid(req)` for other routes.

## Route Classification

### Research App (`apps/research/api/`)

| Route | Status | Why |
|---|---|---|
| `auth-gate.js` | Public (login) | The login endpoint itself |
| `binance-ticker.js` | Public | Free public data, used by horizontal market bar |
| `img-proxy.js` | Public + SSRF guard + 120/min | CORS proxy; rate-limited and private-IP-blocked |
| `indexnow.js` | Public + optional secret | Search-engine ping; protected by `INDEXNOW_API_SECRET` if set |
| `codex.js` | Origin-allowlist + per-action rate limit | See `_lib/codex-guard.js` |
| `codex-usage.js` | Admin only | Requires `x-admin-key` header matching `ADMIN_KEY` env |
| `monarch-api.js` | Gated (fn=chat) | LLM burn — what the attacker hit. Health stays open. |
| `intel-api.js` | Gated | Brain/dossier/calendar use internal Spectre Data API key |
| `data-api.js` | Gated | Coinglass + DexScreener + Spectre Data API |
| `news-api.js` | Gated | CryptoCompare + CryptoPanic quotas |
| `social-api.js` | Gated | X-Dash quota |
| `market-api.js` | Mixed | `fear-greed` public (marketing); rest gated |
| `media-api.js` | Gated | ElevenLabs (paid per char) + X-Dash + media library |
| `trade-api.js` | Mixed | `swap` public (Privy JWT inside); rest gated (Codex bars, on-chain) |
| `account-api.js` | Mixed | `fee-config`/`user`/`admin`/`referral` Privy-guarded; `notifications-api` gated |
| `you-api.js` | Gated | Personal events + compose LLM |
| `tweets-search.js` | Gated | X-Dash backend |
| `tweets-official.js` | Gated | X-Dash backend |
| `welcome-tweets.js` | Gated | High-frequency home widget — biggest quota burner |
| `stocks.js` | Gated | Yahoo + Finnhub |
| `cg-proxy.js` | Gated | CoinGecko Pro tokens |
| `token-resolve.js` | Gated | Falls through to CoinGecko + Codex search |
| `convert-ids.js` | Gated | CoinGecko `coins/{id}` Pro |
| `token-color.js` | Public GET / Gated POST | Read is harmless; write must not be poisonable |
| `token-stubs.js` | Public | Returns canned empty data; no upstream calls |
| `cron/warm-cache.js` | Vercel cron only | Vercel blocks external invocations |

### Trading App (`apps/trading/api/`)

| Route | Status | Why |
|---|---|---|
| `auth-gate.js` | Public (login) | Login endpoint |
| `codex.js` | Origin-allowlist + per-action rate limit | See `_lib/codex-guard.js` |
| `codex-stream.js` | Origin-allowlist + per-action rate limit | Same |
| `cg-proxy.js` | Gated | CoinGecko Pro |
| `tweets-search.js` | Gated | X-Dash |
| `tweets-official.js` | Gated | X-Dash |
| `x-dash-kols.js` | Gated | X-Dash |
| `x-dash-narrative-tokens.js` | Gated | X-Dash |
| `x-dash-search.js` | Gated | X-Dash |
| `x-dash-token.js` | Gated | X-Dash |
| `dexscreener-pair.js` | Gated | DexScreener |
| `dexscreener-watchlist.js` | Gated | Firestore + DexScreener per-pair |
| `bars.js` | Gated | Codex `getTokenBars` quota |
| `alerts.js` | Gated | Codex webhook quota |
| `swap.js` | Privy JWT | Per-call wallet auth |
| `user.js` | Privy JWT | PII |
| `referral.js` | Privy JWT | PII |
| `social.js` | Privy JWT | Posts/likes |
| `onchain.js` | Origin-allowlist | onchain.spectreai.io proxy |
| `fee-config.js` | Public | Anon swap-quote flow needs this |
| `market-fear-greed.js` | Public | Chrome extension consumer; CMC cached 5min, 60/min limited |
| `img-proxy.js` | Public + 120/min | Share-card canvas needs CORS images |
| `token-color.js` | Public GET / Gated POST (TODO) | Same as research |
| `token-tax.js` | Public | Returns canned `{ buyTax: 0 }` stub |
| `webhook.js` | Codex signature | SHA256-verified callback |

## Frontend Cookie Transport

The `spectre-gate` cookie is `SameSite=Strict; Secure; HttpOnly`. Same-origin
fetches send it automatically (default `credentials: 'same-origin'`), so the
161 existing `fetch('/api/...')` call sites in `apps/research/src/` don't need
`credentials: 'include'`. The only place that needs the explicit flag is the
auth-gate component itself (verify + login), which already has it.

## Environment Variables

| Var | Where | Purpose |
|---|---|---|
| `TEAM_GATE_PASSWORD` | Vercel project env (both apps) | The shared team password. Never committed. |
| `AUTH_GATE_SECRET` | Optional, Vercel env | If unset, HMAC secret derives from `sha256("spectre-gate:" + TEAM_GATE_PASSWORD)`. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Vercel KV addon | Rate limiter and cookie session-bucket. |
| `ADMIN_KEY` | Vercel env (research only) | Required to read `/api/codex-usage`. |
| `CODEX_API_KEY`, `COINGECKO_API_KEY`, `X_DASH_API_KEY`, `CRYPTOCOMPARE_API_KEY`, `CRYPTOPANIC_API_KEY`, `FINNHUB_API_KEY`, `CMC_API_KEY`, `ELEVEN_LABS_API_KEY` | Vercel env (per app) | External provider keys; never shipped to bundle. |

## Rotation Procedure

If the team password leaks:

1. Generate a new password (>=16 chars, mixed case + digits).
2. Vercel dashboard → research project → Settings → Environment Variables →
   update `TEAM_GATE_PASSWORD`. Save.
3. Repeat for the trading project.
4. Redeploy both projects (Vercel does this automatically on env change).
5. All existing `spectre-gate` cookies become invalid because the derived HMAC
   secret changes — every browser will be forced through the login form on
   next request.
6. Tell the team the new password out-of-band (1Password shared vault).

## Rate Limits & Origin Allowlists Already in Place

- `_lib/codex-guard.js`: Origin allowlist (Spectre domains + localhost) plus
  per-action rate limit (search=20/min, bars=60/min, etc.).
- `_lib/ratelimit.js`: Sliding-window per-IP via Vercel KV (in-memory fallback
  in dev). Used by auth-gate (5/15min), cg-proxy (60/min), bars (120/min),
  img-proxy (120/min), fear-greed (60/min).
- CORS allowlist: every route echoes back only the specific allowed origin
  (`http://localhost:5180/5181`, `https://app.spectreai.io`,
  `https://trade.spectreai.io`). No `*` wildcards.

## Known Remaining Gaps (proper fix in 2026-05-12 auth rewrite)

- **`spectre-gate` cookie is shared-team, not per-user.** Anyone who knows the
  team password gets full access. The proper fix is Privy-based per-user
  sessions with role claims.
- **No audit log of cookie issuance.** If the cookie leaks we can't see who
  used it. Need KV-backed session table tied to a hashed device fingerprint.
- **`token-color` POST and `social` (trading) write paths still gate on the
  team cookie only.** Should require Privy + Spectre token holding.
- **`market-fear-greed` (trading) is fully public** to support the Chrome
  extension. Extension should switch to its own API key header.
- **Origin allowlist on `codex` is the only defense against cross-origin
  abuse** — if an attacker controls a browser at an allowed origin (e.g.
  XSS on app.spectreai.io itself) the guard fails open. The auth cookie
  layered in tomorrow's rewrite closes that.
