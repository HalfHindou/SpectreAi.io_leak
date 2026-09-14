# Monarch AI: @ Project UX + Agent Reliability Plan

## 1. Goals

- **@ Project UX:** Typing `@ project` and selecting a token should feel smooth; the composed sentence should read naturally; the @ mention must render as a clear **tag** (pill) in the chat, not break the sentence or look awkward.
- **Agent reliability:** The agent must stay fluid, perform the task, and never “break down” or leave the user with raw errors. It should use AI crawl, web search, and X scan (with your API keys) and always return a readable response or a friendly fallback.

---

## 2. @ Project UX Logic

### 2.1 Current problems

- **Awkward sentence:** The chip shows “Asking about @ SPECTRE” plus the rest of the input, so the line reads like “Asking about @ SPECTRE what is tokenomics” instead of “What is @SPECTRE tokenomics?”
- **@ not tagged in chat:** The user message in the chat should show the @ mention as an inline tag (pill) so it’s clear and consistent with the input.
- **Not smooth:** After selecting from the dropdown, the input is cleared in a way that makes the sentence feel disjointed.

### 2.2 Desired behavior

| Step | Behavior |
|------|----------|
| User types | e.g. `what is @ spe` |
| Dropdown | Shows token results for “spe”. |
| User selects token | e.g. SPECTRE. |
| **Input after select** | Show a single **inline @ tag** (pill): `@SPECTRE` with no “Asking about” prefix. The **rest of the sentence** stays in the input: e.g. `what is ` + `[@SPECTRE]` + ` ` (user can continue typing). So the full line reads: “what is @SPECTRE” + optional “ tokenomics”. |
| **On send** | Stored user message: `content` = full sentence, `tokenRef` = { symbol, name, logo }, `contentBeforeAt` = “what is ”, `contentRest` = “tokenomics” (or whatever they typed after the tag). |
| **Chat display** | Render: `contentBeforeAt` + `[@SPECTRE pill]` + ` contentRest`. So the bubble shows: “what is @SPECTRE tokenomics” with @ clearly tagged. |

### 2.3 Data model (user message)

- `content` – Full sentence string (for fallback / parsing).
- `tokenRef` – `{ symbol, name, logo }` when message includes an @ mention.
- `contentBeforeAt` – Text before the @ mention (e.g. `"what is "`).
- `contentRest` – Text after the @ mention (e.g. `"tokenomics"`).

If `contentBeforeAt` is missing (old messages), derive from `content` and `tokenRef` or show `[@symbol] contentRest`.

### 2.4 Input composition rules

- **Chip:** Display only the @ tag: `@` + symbol (or name), no “Asking about” or “sentence tail” wrapper. One compact pill: `@SPECTRE`.
- **On select from dropdown:** Set `selectedToken`; set `input` = `beforeAt + " "` (one space so they can continue). Do not wipe the “before” part; do not add extra wording.
- **Send:** `userText` = `contentBeforeAt + "@" + symbol + " " + contentRest` (trimmed). Store `contentBeforeAt` and `contentRest` so chat can render the tag in the right place.

---

## 3. Agent Reliability Logic

### 3.1 Principles

- **Never break down:** Every API call (links, crawl, tweet, AI answer) is wrapped in try/catch. On failure, show a **friendly fallback** message, never a raw error or blank state.
- **Fluid pipeline:** One clear flow: resolve project → gather context (crawl / X / news) → LLM answer with context. If a step fails, skip it and continue with whatever context is available.
- **Always respond:** The user must always get a reply: either the AI answer, or a short fallback (“I couldn’t fetch X; here’s what I have: …” or “Try another symbol.”).

### 3.2 Pipeline (high level)

1. **Resolve project** – `getProjectLinks(symbol | { address, networkId })`. On fail → reply: “I couldn’t find links for that symbol. Try another name or symbol.”
2. **Gather context (in parallel where possible):**
   - **Crawl** – If `website`, call `/api/project/crawl?url=...&intent=about|roadmap|whitepaper`. On fail → use null; do not block.
   - **X / latest tweet** – If `twitter`, call `/api/project/latest-tweet?twitterUrl=...`. On fail → use link + “Open to see latest posts.”
   - **News** – For “about”, optionally fetch headlines (existing flow). On fail → use null.
3. **Answer** – `POST /api/ai/answer` with `{ query, context }`. On fail → fallback: show crawled text (or link) + “AI is temporarily unavailable; here’s what I found.”
4. **Loading state:** Show “Checking @X…” / “Fetching…” then **always** replace with final message or fallback (with timeout so we never leave “Fetching…” forever).

### 3.3 Error handling (server)

- **Crawl:** Timeout (e.g. 8s); on timeout or 4xx/5xx return JSON with `error` and optional `text` fallback (e.g. meta description if already extracted).
- **Latest tweet:** If no `TWITTER_BEARER_TOKEN` or API error, return `{ url, message: "X: <link> — Open to see latest." }`.
- **AI answer:** If no `OPENAI_API_KEY`, return 200 with `text` = summarized context (crawl + link). If OpenAI errors, return 200 with `text` = fallback (crawled snippet + link), not 502 with no body.

### 3.4 Error handling (client)

- On `getProjectLinks` fail → set message: “I couldn’t find links for ‘X’. Try another symbol or name.”
- On crawl / tweet fail → continue with `crawledText` / `twitterUrl` as null or link-only; still call AI with whatever context exists.
- On `fetchAiAnswer` fail → set message: “I couldn’t get an AI summary right now. Here’s what I have: [crawled text or link].”
- **Timeout:** All fetches should have a timeout (e.g. 15s for AI, 8s for crawl); on timeout, treat as failure and use fallback.
- **No infinite loading:** If the pipeline takes too long (e.g. 20s), replace loading message with: “This is taking longer than usual. Here’s what I have so far: …” or “Try again in a moment.”

### 3.5 API keys (your setup)

- **Crawl:** No key; server fetches the project URL.
- **Web search:** If you add a search API later, the agent can pull in extra context and pass it in `context` to the LLM.
- **X scan:** `TWITTER_BEARER_TOKEN` (or `X_BEARER_TOKEN`) in `.env` for latest tweet; if missing, fallback to link-only.
- **AI:** `OPENAI_API_KEY` for LLM answers; if missing, server still returns 200 with summarized crawl + links.

---

## 4. Task Summary

### Phase A: @ Project UX

1. **Chip:** Remove “Asking about” and “sentence tail”; show only `@` + symbol (or name) as one pill.
2. **On select:** Keep `beforeAt` in the input, set `input` = `beforeAt + " "` (one space); user continues typing after the chip.
3. **Send:** Compute and store `contentBeforeAt` and `contentRest` in the user message; send full sentence to backend.
4. **Chat display:** Render user messages with `contentBeforeAt` + `[@symbol pill]` + ` contentRest` so the @ is clearly tagged and the sentence is smooth.

### Phase B: Agent reliability

1. **Server:** Ensure crawl, latest-tweet, and AI answer always return a JSON body with a `text` or `message` fallback on error (no bare 502/500 with no user-facing text).
2. **Server:** Add timeouts for crawl and AI; on timeout return fallback text.
3. **Client:** Wrap all project-intent calls in try/catch; on failure set a friendly reply and never leave “Fetching…”.
4. **Client:** Add a global timeout (e.g. 18s) for the whole @ project flow; on timeout replace loading with a fallback message.
5. **Client:** When AI or crawl fails, still show crawled snippet or link so the user gets value.

---

## 5. Files to touch

- **@ UX:** `src/components/AIAssistant.jsx` (chip copy, input on select, message shape, chat render), `src/components/AIAssistant.css` (chip styling if needed).
- **Agent:** `src/components/AIAssistant.jsx` (error handling, timeouts, fallback messages), `server/index.js` (error responses with fallback `text`, timeouts), `src/services/projectLinksApi.js` (optional: timeout wrappers).
