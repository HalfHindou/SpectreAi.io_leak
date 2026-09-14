# Plan: @ Project – Socials, Website, Twitter, Latest Tweet, Roadmap, Whitepaper (AI Crawl)

## Implementation status (current)

- **Website crawl**: Server `/api/project/crawl?url=...&intent=roadmap|whitepaper|about` fetches the project URL, strips HTML, and returns text (roadmap snippet, whitepaper 2 sentences, or about/meta ~400 chars). Assistant calls this and shows the result in chat; on failure shows “I tried to crawl but couldn’t load it” + link.
- **X/Twitter**: `/api/project/latest-tweet?twitterUrl=...` returns the profile link + short message (no live tweet content without API). Assistant shows “Their profile: URL (open to see latest posts).”
- **Flow**: User selects token from @ dropdown (chip shows “Asking about @ Token”) or types “@ symbol …”. Assistant builds message “@ SYMBOL intent”, resolves links via `getProjectLinks`, then runs crawl or chart action. Chip stays until send or remove; clicking the sentence focuses the input.

## Goal

When the user **@-mentions a project** in the AI assistant and asks for:
- **Socials / website / Twitter** → show links (website, Twitter, Discord, Telegram).
- **Latest tweet** → fetch and show the project’s latest tweet (or fallback to Twitter link).
- **Roadmap** → crawl the project’s site for roadmap content and return a short summary.
- **Whitepaper** → crawl/find whitepaper and return **at most 2 sentences** (summary or opening).

The assistant must be able to **resolve the @ project** to its links, then **crawl** (or call external APIs) only when the user asks for tweet/roadmap/whitepaper.

---

## 1. Where project links come from

| Source | When | Data |
|--------|------|------|
| **Codex token details** | Token has `address` + `networkId` (from search or selection) | `getDetailedTokenInfo(address, networkId)` → `socials: { website, twitter, discord, telegram }` (already returned by `api/codex.js` details handler). |
| **CoinGecko** | Major tokens (e.g. BTC, ETH, SOL) when we only have symbol | `getCoinDetails(symbol)` → `links: { homepage, twitter, reddit, explorer }` (already in `coinGeckoApi.js`; only BTC/ETH/SOL have IDs today – can extend `COIN_IDS` for more majors if needed). |

- **Unified “project links”**: For any @ token we need a single path: **resolve token → get links**.
  - If we have **address + networkId** (e.g. user selected from @ dropdown, or we got it from search): call **Codex token details** → use `socials`.
  - If we only have **symbol** and it’s a major (BTC, ETH, SOL, …): call **CoinGecko** `getCoinDetails(symbol)` → use `links` (map to same shape: website = homepage, twitter).
  - If we only have **symbol/name** (e.g. “spectre”, “palm”): **search first** (existing `useTokenSearch` / Codex search) → get first result’s `address` + `networkId` → then **Codex token details** → `socials`.

So: no new “project links API” – we reuse **Codex details** and **CoinGecko details**, and add a small **resolve token → links** layer used by the assistant.

---

## 2. Assistant: parsing “@ project” + intent

- **Input**: User message like `@ spectre latest tweet`, `@ palm roadmap`, `@ eth whitepaper`, `@ solana website`.
- **Parse**:
  1. **Token**: Text after last `@` up to the next space or end, or the **last selected token** from the @ dropdown (if we store “current @ token” when they pick from dropdown). Prefer: parse from message so it works even without dropdown (e.g. “@ spectre latest tweet” → token = “spectre”).
  2. **Intent**: Keywords in the rest of the message:
     - `latest tweet` / `last tweet` / `twitter` (when asking for content) → **latest_tweet**
     - `roadmap` → **roadmap**
     - `whitepaper` / `white paper` → **whitepaper**
     - `website` / `site` / `socials` / `links` → **socials** (links only, no crawl)

- **Resolve token → project links**:
  1. **By symbol (majors)**: If token is BTC/ETH/SOL (and any we add to CoinGecko), call `getCoinDetails(symbol)` → get `links` (homepage, twitter).
  2. **By search**: Otherwise call search (Codex or existing `useTokenSearch` server path) with token string → take first result → `address`, `networkId` → call **Codex token details** → get `socials`.
  3. Cache or pass **website**, **twitter** (and optionally discord, telegram) into the next step.

- **Reply**:
  - **socials**: Reply with “Website: …, Twitter: …, Discord: …” (whatever we have). No crawl.
  - **latest_tweet**: Call backend **“get latest tweet”** with Twitter URL (or return link + “Open to see latest tweets” if we don’t implement fetch).
  - **roadmap**: Call backend **crawl** with `website` + intent `roadmap` → backend returns text snippet → assistant shows short summary in chat.
  - **whitepaper**: Call backend **crawl** with `website` (or whitepaper URL if we discover it) + intent `whitepaper` → backend returns **max 2 sentences** (extract or summarize) → assistant shows in chat.

---

## 3. Backend: crawl and “latest tweet”

All crawling and external fetch must happen **server-side** (CORS, security, rate limits).

### 3.1 New endpoints (suggested)

- **GET (or POST) `/api/project/links`** (optional)
  - Input: `symbol` or `address` + `networkId`.
  - Logic: Resolve token (Codex details or CoinGecko) and return `{ website, twitter, discord, telegram }`.
  - Use: Central place for “resolve @ project → links”; frontend or assistant can call this so link resolution lives in one place.

- **GET `/api/project/crawl`**
  - Input: `url` (required), `intent` = `roadmap` | `whitepaper`.
  - Logic:
    - **roadmap**: Fetch `url` (and optionally common paths like `url/roadmap`, `url/#roadmap`). Parse HTML, find sections containing “roadmap” (or similar). Extract text, return first ~500 chars or a short summary (no LLM required for MVP – e.g. first paragraph containing “roadmap”).
    - **whitepaper**: Resolve whitepaper URL (e.g. link with “whitepaper” in href, or `url/whitepaper`, `url/whitepaper.pdf`). Fetch content (HTML or PDF). Extract text (PDF: use a small lib or service). Return **at most 2 sentences** (e.g. first 2 sentences of main content, or call a small LLM “summarize in 2 sentences” if we add it later).
  - Security: Only allow URLs that are in an allowlist derived from **project links we already have** (e.g. same origin as token’s `website`), or strict allowlist of domains. Timeout (e.g. 5–10 s), max body size, no JS execution.

- **GET `/api/project/latest-tweet`**
  - Input: `twitterUrl` (e.g. `https://twitter.com/ProjectName` or `https://x.com/...`).
  - Logic:
    - **Option A**: Use Twitter API v2 (requires API key, rate limits). Fetch user’s latest tweet → return text (and optionally link). Best UX but needs approval and key.
    - **Option B**: Use a third-party “latest tweet” API/service (e.g. some RSS or syndication endpoints – check ToS).
    - **Option C (MVP)**: Don’t fetch. Return the Twitter URL and a fixed message: “Here’s their Twitter: [link]. I can’t fetch live tweets here.” Then later replace with Option A or B.
  - Recommendation: Start with **Option C**; add Option A or B when keys/service are ready.

### 3.2 Safety and limits

- **Allowlist**: Crawl only URLs that are either (1) the token’s `website` / `twitter` from our own APIs, or (2) a curated allowlist of known project domains. Reject arbitrary URLs.
- **Rate limit**: Per user or per IP (e.g. 10 crawl requests per minute).
- **Timeout**: 5–10 s per request.
- **Max size**: Cap response size (e.g. 100 KB for HTML/PDF) to avoid abuse.
- **No JS**: Fetch HTML/PDF only; no headless browser in MVP.

---

## 4. Frontend (AI assistant) flow

1. **User** types e.g. `@ spectre latest tweet` or selects a token from @ dropdown and then “latest tweet”.
2. **AIAssistant**:
   - Parses **token** (from message or from “current @ token” if we store it).
   - Parses **intent**: `latest_tweet` | `roadmap` | `whitepaper` | `socials`.
3. **Resolve links**:
   - Call **`/api/project/links?symbol=...`** (or with `address` + `networkId` if we have it), **or** use existing client-side `getDetailedTokenInfo` + `getCoinDetails` and map to `{ website, twitter }`.
4. **If intent === socials**: Reply with the links (no backend crawl).
5. **If intent === latest_tweet**: Call **`/api/project/latest-tweet?twitterUrl=...`** (or show link + fallback message if not implemented).
6. **If intent === roadmap**: Call **`/api/project/crawl?url=...&intent=roadmap`** → get text → reply with short summary in chat.
7. **If intent === whitepaper**: Call **`/api/project/crawl?url=...&intent=whitepaper`** → get 2 sentences → reply in chat.

Optional: Show a short “Fetching…” state in the chat while calling crawl/latest-tweet.

---

## 5. Implementation order

| Step | Task | Notes |
|------|------|--------|
| 1 | **Resolve @ token → links** | Unify Codex details + CoinGecko in assistant: given symbol or (address, networkId), return `{ website, twitter, discord, telegram }`. Optional: add `/api/project/links`. |
| 2 | **Intent parsing** | In AIAssistant, detect `latest_tweet`, `roadmap`, `whitepaper`, `socials` and extract token from message (or from dropdown). |
| 3 | **Reply for “socials”** | When intent is socials/website/twitter, reply with project links only. No new backend. |
| 4 | **`/api/project/crawl`** | New serverless (or server) endpoint: allowlisted URL, fetch HTML, roadmap vs whitepaper logic, return text (whitepaper: max 2 sentences). |
| 5 | **`/api/project/latest-tweet`** | MVP: return Twitter URL + “Open to see latest tweets.” Later: integrate Twitter API or third-party. |
| 6 | **Wire assistant to crawl** | When intent is roadmap/whitepaper, call crawl API and show result in chat. When latest_tweet, call new endpoint or show link. |
| 7 | **Extend CoinGecko links** | If we want majors beyond BTC/ETH/SOL, extend `COIN_IDS` in `coinGeckoApi.js` and use `getCoinDetails` for them. |

---

## 6. Summary

- **Project links**: Already available from **Codex token details** (`socials`) and **CoinGecko** (`links`). Add a single “resolve token → links” path (client or optional `/api/project/links`).
- **Assistant**: Parse “@ project” + intent (socials | latest_tweet | roadmap | whitepaper); resolve token to links; for socials, reply with links; for tweet/roadmap/whitepaper, call backend.
- **Backend**: New **crawl** endpoint (roadmap + whitepaper, 2 sentences max for whitepaper), and **latest-tweet** endpoint (MVP: return link + message; later: real fetch).
- **Security**: Crawl only allowlisted URLs (from our own project links), rate limit, timeout, max size, no JS.

This keeps the current @ token search and add-to-watchlist flow unchanged and adds a clear path to “when user asks for latest tweet / roadmap / whitepaper, AI crawls through the site” (server-side) and shows socials/website/Twitter when asked.
