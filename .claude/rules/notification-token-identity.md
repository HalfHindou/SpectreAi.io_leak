---
paths:
  - "apps/research/src/hooks/useNotification*.js"
  - "apps/research/src/lib/notification-destination.js"
  - "apps/research/src/pages/intelligence/**"
---

# Notifications — a ticker is not a token identity

**Created:** 2026-08-24 · **Trigger:** Nick via TG: "When I click on the notification from Catalorian, it sends me to the wrong coin. It should be a 1.42m mcap coin but it sends to a 250k mcap coin." Sunny: "if its a shitcoin like this you should really link it to ai screener and if you make a call on notification make sure it matches. fix it with x dash" · then: "since tg and x dash called sol, eth shouldnt have been the one shown. also prioritize the tokens with more volume and mc. also notifications should also not pop for tokens that have rug warning"

**State:** box changes are LIVE on prod (Hetzner). App **SHIPPED to main as `ad89759ac`** (pushed direct from `~/spectre-notifid-wt`, branch `claude/notif-token-identity`).

---

## A. What actually happened (measured, not inferred)

The card read `CATALORIAN breakout — 24 authors @ $1.42M`. Every number in it, and the token it opened, was a different thing:

| | value | what it really was |
|---|---|---|
| the token the detector scored | cg_id `elon-s-space-cat`, **Solana**, `4cvZwC17oMiUA7peKX5GhbaUWv4U5Lwrd8118xnFpump` | "Elon's Space Cat", the pump.fun mint — the same pair Sunny found on DexScreener (`FvYok1cE…vKoJ5Q`) |
| the token the card opened | ticker `CATALORIAN` → CoinGecko → `0x88a…301a` | a **$254K Ethereum** namesake |
| the mcap the card printed | $1,422,204 | X Dash's index-time snapshot, **frozen**; live was **$312,960** |
| the token's real state | entry $8,969,146 → peak $24,283,950 → $312K | **−96% off entry**: our own X Dash board tags it **RUGGED** |

So one card managed to be wrong about the chain, the coin, the price, and the setup.

## B. Four separate defects, all confirmed in the data

1. **The detector threw the identity away.** `intel-signal-detector.js` reads `social_metrics_xdash`, whose `asset` column **is the CoinGecko id** (`cupsey-2`, `dia-data`, `elon-s-space-cat`), then wrote `asset: sym` — the ticker — and dropped the cgId. From that row onward nothing downstream could tell one CATALORIAN from another.
2. **The feed never shipped what it had.** `/v1/notifications/feed` selected `data` and used exactly one field from it (`category`). `early_runner` had been putting `contract_address` + `chain` in `data` all along; nobody read them.
3. **The app routed on a ticker.** `signal-card.jsx#resolveDestination` returned `{kind:'rz', symbol}` from `meta.asset` alone, and the poller's `meta` carried nothing else. The file's own comment predicted this: *"X Dash is deliberately NOT a target yet… the notifications payload carries only a ticker."*
4. **The cooldown was keyed on the wrong column, so it never fired.** `recentlyAlerted(t.asset, …)` looked up the **cgId** in a table where `insertSignal` had written the **ticker** — no row ever matched. CATALORIAN was pinged **11 times in 6 hours** (306737 → 307439); the feed's `DISTINCT ON (dedupe_key)` hid it from the bell.

## C. The rule now

**Never route a shitcoin by its ticker.** In order:

1. **contract address** → the AI Screener / trading terminal, BY ADDRESS (an address means one token, and a DEX pair is where a micro-cap's chart lives). Gated on `mcap < SCREENER_MAX_MCAP` ($50M) or no mcap at all.
2. **cgId** → Research Zone pinned to that slug. `/research-zone/elon-s-space-cat` — no query string (see the trap below).
3. **bare ticker** → the old path, which is now only reached by majors/CEX assets where a ticker IS unambiguous. If it is not a known major, the ambiguity is broken by **market cap, then 24h volume** — the biggest token wearing the ticker is the one a reader means.

The card also **states the identity it scored**: a chain chip + the truncated contract under the prose, so the reader can check the call against the destination before clicking.

## D. Files

**Box** (`/opt/spectre-data-api`, backups `*.bak.tokenidentity-20260824`, restarted):
- `src/workers/xdash-leaderboard-sync.js` — `metadata` now carries `contract_address` + `name` (X Dash's `/api/bootstrap` had them all along: `contract_address`, `platforms`, `cg_id`, `chain`, `market_cap`).
- `src/workers/intel-signal-detector.js` — the husk gate, a live DexScreener read for the token about to be pinged, the cooldown key fix, and `cg_id`/`symbol`/`token_name`/`contract_address`/`entry_market_cap`/`peak_market_cap`/`mcap_source` on the signal.
- `src/api/routes/notifications.js` — `cgId`, `chain`, `contractAddress`, `tokenName`, `mcap` on every `signal_alert` item.
- One-off SQL: back-filled identity onto 23 active signals, expired the 11 CATALORIAN husks.

**Telegram bot** (`~/spectre-tg-bot` → main `195910d`, deployed to `/opt/spectre-tg-bot`, backups `*.bak.notifidentity-20260824`):
- `src/subscriptions.js` — `feedMessage` carries the feed's `cgId` (powers the X-Dash deep-link) and hands the contract on as a **candidate**; the enrichment pass verifies it on-chain before any button is built, then `resolveToken()` stays as the fallback for symbol-only sources (hunter).
- `src/spectre-api.js` — `verifyToken` no longer treats a non-answer as a verdict (see §F).

**App** (`~/spectre-notifid-wt`):
- `src/lib/notification-destination.js` — **new**, the whole rule + the single opener.
- `signal-card.jsx` — imports the rule, renders the chain/CA line, routes its own asset chip through the resolved destination.
- `notification-panel.jsx` + `IntelligenceFeedPage.jsx` — both had grown their own copy of the "what do I do with a destination" switch; now one opener.
- `useNotificationPoller.js` — carries the identity into `meta`.
- `notification-panel.css` — the identity line, dark + day.

## E. The rug gate

Mirrors `rowRug()` in the X Dash board so the bell can never ping something the board is simultaneously tagging as dead:

- **rugged** — live mcap ≤ 20% of `momentum_origin.entry_market_cap` (the mcap X Dash first surfaced it at).
- **spent** — it pumped for real (peak ≥ 1.6× entry) and gave back ≥ 85% of the peak. The move is over; "early" would be a lie.

A collapsed husk keeps qualifying for the `< $2M` micro-cap filter **because** it collapsed — that is the whole trap. Live dry-run, one pass: CATALORIAN suppressed (`rugged: 96% below the $8.97M it was surfaced at`), FEFER suppressed (`spent: 88% below its own $5.01M peak`), GOOGLC/FIRE/PANTS/CAT/PURR/WIRE/PACK emitted normally.

## F. 🪤 Traps

- **`social_metrics_xdash.asset` IS the cgId**, not a symbol. `metadata->>'symbol'` is the ticker. Reading them the other way round is this whole bug.
- **A cgId destination must NOT also carry `?tokenSymbol=`.** Tried it to stop RZ printing the slug as the ticker on a cold load (`ELON-S-SPACE-CAT TO USD CONVERTER`): the symbol **wins** the resolve, the path is rewritten `/elon-s-space-cat → /catalorian`, and the page lands back on the $254K Ethereum namesake. Measured, reverted, comment left at the call site. The bare cgId slug is the identity. The cosmetic ticker on a cold slug load is a separate RZ defect — do not "fix" it from here.
- **A backtick inside a SQL comment terminates the JS template literal.** `` -- IDENTITY. `asset` here is… `` inside a `db.query(\`…\`)` produced `SyntaxError: missing ) after argument list` 90 lines away.
- **X Dash's `market_cap` is frozen at index time.** CATALORIAN's row said $1.42M for hours while the token traded at $312K. `momentum_origin.last_market_cap` is the same source and no fresher. The only live number is a contract-keyed DexScreener/GT read — which is why the detector now takes one for the single token it is about to ping (≤2/hour, Redis-cached in `dex-resolver`).
- **A delta needs a live number.** Quoting a frozen index price under a "breakout" headline is the same class as the Traders-Corner "OI +0.00%" fabrication.
- **An empty answer is not a negative — and DexScreener gives them.** `verifyToken` (TG bot) calls `/latest/dex/tokens/<ca>` and cached whatever it got for 15 min. Measured 2026-08-24: the same address returned **0 pairs and 5 pairs seconds apart**, HTTP 200 both times, and a network throw was indistinguishable from a real mismatch. Either one cost that token its "AI Screener" button on every alert for the next 15 minutes. Now: an empty answer is retried once and **never cached**; only a NON-EMPTY pair list that fails the match is a true negative — which is exactly the clone case the cache exists for. Same family as the Traders-Corner "only a real HTTP response is evidence" lesson.
- **GOOGLC is not a shitcoin and not the stock.** It is **Alphabet (Coinbase Tokenized Stock)** — a $1.0M tokenized equity on **Base**, `0xb2000000000000000000002d0ba3164cc74f58b7`, DexScreener base symbol `GOOGLc`. The equity is GOOGL on NASDAQ; routing there would show a ~$2.5T company under a $1.01M call. Founder call 2026-08-24: **tokenized stocks route to the AI Screener by contract**, like any other on-chain token. Nick's "$580.40 / MARKET CAP $0 / No markets found" screenshot is Research Zone trying to price it through the crypto lane.
- **The dev proxy hits the real box.** `vite.config.js` proxies `/data-api` to `204.168.244.18:3850` with the key from env, so the notification feed in dev is production data — end-to-end verification needs no mocking.

## G. Verified

- 12/12 assertions on the real bundled destination module (esbuild-bundled with its actual imports, not a copy).
- Live browser, dev on `:5205`, real feed: identity reaches `meta` (cgId + chain + contract + name + mcap); cards render `Base 0xb2…58b7` / `Open GOOGLC in AI Screener`; a click opens `#token/0xb200…f58b7` on the terminal and does **not** navigate RZ; a cgId-only card lands `/research-zone/elon-s-space-cat` showing contract `4cvZwC…pump`, Solana/Meme/Pump.fun, **$310,253**; a bare-major card still lands `/research-zone/bitcoin` instantly.
- `/v1/notifications/feed` on prod: CATALORIAN gone (expired as a rug), GOOGLC + FIRE carrying full identity, `early_runner` DELTA exposing the contract it always had.
- `npm run build:research` clean, `[check-critical-path] OK`.

## H. Left open

- **Chain-aware disambiguation.** The mcap/volume tiebreak cannot filter by chain — `/coins/markets` returns no `platforms`. It never fires for a signal that carries identity, so this only matters for legacy rows.
- **The RZ cold-slug ticker** (`ELON-S-SPACE-CAT TO USD`) — pre-existing for any cgId deep link, see the trap in §F.
- **Board-wide frozen mcap** is still a data-lane ask (`data-lane-fixes-for-alaa.md` §1); the detector now works around it for the one token it pings.
- `intel-signal-detector.js` is **untracked on the box** — a hotpatch file that exists nowhere else. The backup is the only other copy.
