# Making APIs Work – Crawler, Search, News, X

Real-time search, AI crawler, news, and X (Twitter) depend on your **backend server** and **API keys** in `.env`.

## Quick start (step by step)

1. **Setup env and check keys**
   ```bash
   npm run setup
   ```
   This creates `.env` from `.env.example` if missing and prints which API keys are set.

2. **Edit `.env`**  
   Set at least `CODEX_API_KEY` (get one at [codex.io](https://codex.io)). Optionally set `OPENAI_API_KEY`, `TWITTER_BEARER_TOKEN`, etc.

3. **Run the app (server first, then dev)**
   - **Two terminals:**  
     First: `npm run server` (terminal 1 – leave running)  
     Then: `npm run dev` (terminal 2)
   - **One command:**  
     `npm run dev:both` (starts server first, then dev)

4. **Open** `http://localhost:5180` and try Monarch Chat: type `@` to search tokens, or ask “@ Bitcoin about” / “news”.

---

## 1. Create `.env` from example

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- **`CODEX_API_KEY`** (required) – for token search, prices, trending. Get a key at [codex.io](https://codex.io).
- Optionally: `COINGECKO_API_KEY`, `OPENAI_API_KEY`, `CRYPTOCOMPARE_API_KEY`, `TWITTER_BEARER_TOKEN` (see below).

## 2. Run the backend server first, then dev

The frontend talks to the backend at `/api/*`. In dev, Vite proxies `/api` to the server. **Start the server first**, then start the dev server.

**1. Start the server (leave it running):**

```bash
npm run server
```

**2. In another terminal, start the frontend:**

```bash
npm run dev
```

Or run both in order in one terminal (server first, then dev):

```bash
npm run dev:both
```

- Server: `http://localhost:3001`
- Frontend (Vite): `http://localhost:5180` – all `/api` requests are proxied to the server.

If you only run `npm run dev` without the server, token search, crawl, and news will fail.

## 3. What each key does

| Env variable            | Required | Purpose |
|-------------------------|----------|--------|
| `CODEX_API_KEY`         | **Yes**  | Real-time token search (@ dropdown), prices, trending, token details. |
| `COINGECKO_API_KEY`     | No       | Fallback prices when Codex fails. Free tier: leave empty. Pro: set for higher limits. |
| `OPENAI_API_KEY`        | No       | Monarch AI answers from crawled content. Without it, AI returns raw crawl text. |
| `CRYPTOCOMPARE_API_KEY` | No       | News feed. Free tier works without key via server proxy; set for higher limits. |
| `TWITTER_BEARER_TOKEN`  | No       | Fetch latest tweet for “@token latest tweet”. Without it, we only show the X profile link. Get at [developer.twitter.com](https://developer.twitter.com). |

## 4. Troubleshooting

- **Search / @ dropdown empty or “No tokens found”**  
  - Server must be running (`npm run server`).  
  - `CODEX_API_KEY` must be set in `.env` (root of project).  
  - Restart the server after changing `.env`.

- **Crawler doesn’t load site / roadmap / about**  
  - Server must be running (crawl runs on server).  
  - Some sites block non-browser requests; we use a browser-like User-Agent.  
  - For BTC/ETH/SOL we fall back to CoinGecko description if crawl fails.

- **News not loading**  
  - Server proxy: `GET /api/news` (optional `?symbol=BTC&limit=8`). If server is running, frontend uses this and CORS is avoided.  
  - If proxy fails, frontend falls back to CryptoCompare directly (can hit CORS in some setups).  
  - Optional: set `CRYPTOCOMPARE_API_KEY` in `.env` for higher limits.

- **X / “latest tweet” only shows link**  
  - Set `TWITTER_BEARER_TOKEN` (or `X_BEARER_TOKEN`) in `.env` with a Twitter API v2 Bearer Token.  
  - Without it, we only return the profile URL and a message to open it.

- **AI answers are raw text, not summarized**  
  - Set `OPENAI_API_KEY` in `.env` so `/api/ai/answer` can use the LLM.

## 5. Quick check

1. `cp .env.example .env` and set `CODEX_API_KEY`.
2. `npm run server` (in one terminal).
3. `npm run dev` (in another), open `http://localhost:5180`.
4. In Monarch Chat, type `@` and a token name (e.g. `btc`) – search should return results.
5. Ask “@ Bitcoin about” – crawler + (if set) OpenAI should respond.
6. Ask “news” or “@ Bitcoin news” – news should load (via `/api/news` or direct).
