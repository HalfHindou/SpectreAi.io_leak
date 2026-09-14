# @spectre/tg-bot — Spectre AI Intelligence

Rick-class Telegram bot over the Spectre data-api. grammY + custom @napi-rs/canvas chart
renderer (~85ms/chart, $0/chart, 4 themes). Master plan: `~/spectre-tg-bot-master-plan-2026-07-10.md`.

## Run

```bash
npm run dev -w @spectre/tg-bot     # long-polls with TELEGRAM_BOT_TOKEN from root .env
npm run render:test -w @spectre/tg-bot   # writes /tmp/spectre-chart-<theme>.png per theme
```

Env (root `.env`): `TELEGRAM_BOT_TOKEN`, `SPECTRE_API_ORIGIN` (Hetzner box), `SPECTRE_API_KEY`.

⚠️ Only ONE process may long-poll the token — don't run the legacy `packages/telegram-bot`
(the Puppeteer screenshot bot) at the same time or both get 409s.

## Commands

`/p btc` price · `/c btc 4h` chart w/ inline TF switcher (edit-in-place) · `/x sol` full scan
(price + 𝕏 social + TA + chart + buttons) · `/m` market · `/desk` brain desk · `/xd` X-Dash board ·
`/kol wif` voices · `/news` · `/wl add btc` watchlist · `/alert btc >70k` (60s poller) ·
`/settings` theme + default TF · `$SYM` message → price card · reply `x` deletes any bot message.

## Architecture

```
src/index.js          command registry + callback router (c|SYM|tf codec)
src/spectre-api.js    data-api client + micro-cache (ohlcv NEEDS interval+range params)
src/chart.js          canvas candle renderer: EMA20/50, volume, RSI panes, watermark, 2400×1350
src/chart-service.js  candle fetch w/ TF fallback (1h lane can be cold on the box) + PNG cache
src/cards.js          HTML message builders (scan caption ≤1024 chars)
src/themes.js         spectre / noir / matrix / ivory
src/store.js          JSON user store (prefs/watchlist/alerts) → Postgres in Phase 2
src/alerts.js         price-cross alerts, 60s batched poll
```

## Deploy (LIVE since 2026-07-10)

Runs on the Hetzner box: pm2 `spectre-tg-bot` at `/opt/spectre-tg-bot` (root@204.168.244.18),
package-local `.env` with `SPECTRE_API_ORIGIN=http://127.0.0.1:3850`. Fonts: `fonts-dejavu-core`
(installed — box shipped with zero fonts, canvas text renders blank without it).

```bash
# ship an update — NEVER sync data/ (box store.json is the live user/receipts state)
rsync -az --exclude node_modules --exclude data packages/tg-bot/ root@204.168.244.18:/opt/spectre-tg-bot/
ssh root@204.168.244.18 'pm2 restart spectre-tg-bot'
```

⚠️ ONE poller per token: never run the prod token locally while the box process is up (409s).
For local dev create a separate BotFather token and put it in a package-local `.env`.

## Known data quirks (2026-07-10)

- `/v1/prices/{SYM}/ohlcv` requires `interval` + `range` (bare = empty 200); `range` value is ignored.
- 1h interval intermittently empty/slow (box cagg cold) → TF fallback chain handles it.
- X-Dash bootstrap excludes majors (BTC/ETH are context assets) → `/kol btc` honestly says no coverage;
  alts get the full social block.
