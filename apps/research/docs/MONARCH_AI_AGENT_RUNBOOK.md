# Monarch AI Agent: LLM + AI Crawl – Runbook

## Task: Monarch AI agent is LLM-connected and uses AI crawl (web + X context)

### 1. AI Crawl (web)

- **Endpoint:** `GET /api/project/crawl?url=...&intent=roadmap|whitepaper|about`
- **Server:** Fetches project URL, strips HTML, returns text (roadmap snippet, whitepaper 2 sentences, or about/meta ~400 chars).
- **Assistant:** Calls this first when user asks about a project (about / roadmap / whitepaper).

### 2. X/Twitter context

- **Endpoint:** `GET /api/project/latest-tweet?twitterUrl=...`
- **Assistant:** Passes `twitterUrl` (and website, name) into LLM context.

### 3. LLM agent

- **Endpoint:** `POST /api/ai/answer`
- **Body:** `{ query, context: { name?, crawledText?, twitterUrl?, website?, headlines? } }`
- **Server:** If `OPENAI_API_KEY` is set in `.env`, calls OpenAI `gpt-4o-mini` with system prompt: use ONLY this context (web crawl + X link) to answer; be concise; do not make up data.
- **Response:** `{ text, usedLLM }`. Assistant shows `text` in chat.

### 4. Flow (end-to-end)

1. User: @ token + "about" / "roadmap" / "whitepaper".
2. Assistant: "Fetching project info…" → `getProjectLinks` → crawl (when website exists) → optional crypto news (about) → `fetchAiAnswer(userText, context)` → show LLM reply (or fallback to raw crawl + links if no key or LLM fails).
3. **About with website:** crawl + news → context → LLM → reply.
4. **About without website:** news + links → context → LLM → reply.
5. **Roadmap / whitepaper:** crawl → context → LLM → reply.

### 5. Run the task

1. **Backend:** Run on port 3001: `cd server && node index.js`
2. **Env:** `.env` in project root must have `OPENAI_API_KEY=sk-...` (and optionally `CODEX_API_KEY`, `COINGECKO_API_KEY`)
3. **App:** Open Monarch AI → select @ token (e.g. BTC) → type "about" or "roadmap" → send
4. **Expected:** LLM answer in chat using crawled web + X context (or fallback to raw crawl if LLM fails)

### 6. Files

- **Server:** `server/index.js` – `/api/project/crawl`, `/api/project/latest-tweet`, `POST /api/ai/answer`
- **Frontend:** `src/components/AIAssistant.jsx` – project intent, crawl, `fetchAiAnswer`
- **API:** `src/services/projectLinksApi.js` – `getProjectLinks`, `fetchProjectCrawl`, `fetchLatestTweet`, `fetchAiAnswer`
