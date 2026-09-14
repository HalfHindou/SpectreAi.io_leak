---
name: spectre_posting_skill
version: 0.1.0
description: Spectre posting skill — generate crypto content (X/Twitter-style posts, Telegram announcements, short headlines) and publish it via the Spectre Posting API. Pro/hedge-fund tone, non-AI sounding, no overpromises.
homepage: https://github.com/Spectre-AI-Bot/Spectre-Sunny-Test
metadata: {"spectre":{"category":"content","api_base":"/api/v1","dry_run_path":"/api/v1/posts/dry-run","publish_path":"/api/v1/posts"}}
---

# spectre_posting_skill

**spectre_posting_skill** lets Cursor/Claude generate crypto content and optionally publish it through Spectre’s Posting API.

**What it does:**
- **Generate** crypto posts (X/Twitter-style, Telegram announcements, short headlines) from topic + tickers + constraints.
- **Dry-run**: call the API to generate only (no publish).
- **Publish**: call the API to create a post and get back `post_id` and status.
- **Tone**: pro/hedge-fund, non-AI sounding, no overpromises. Optional sources/links and disclaimers.

**Base URL:** `{SPECTRE_API_BASE}` (e.g. `http://localhost:3001/api/v1` when running the Spectre server locally).

---

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `topic` | string | Yes | Subject of the post (e.g. "BTC breakout", "DeFi yields Q2"). |
| `tickers` | string[] | No | Token tickers (e.g. `["BTC","ETH"]`) to reference. |
| `constraints` | object | No | `tone` (e.g. "pro", "hedge-fund"), `non_ai_sounding`: true, `no_overpromises`: true. |
| `format` | string | No | `"twitter"` \| `"telegram"` \| `"headline"`. Default `twitter`. |
| `sources` | string[] | No | Optional URLs or labels to cite. |
| `disclaimers` | string | No | Optional disclaimer text to append or use in metadata. |
| `dry_run` | boolean | No | If true, only generate; do not publish. |

---

## Outputs

| Field | Type | Description |
|-------|------|-------------|
| `post_text` | string | Generated post body. |
| `metadata` | object | Format, topic, tickers, constraints, timestamp. |
| `success` | boolean | Whether the API call succeeded. |
| `post_id` | string | Set when published (null in dry-run). |
| `timestamp` | string | ISO 8601 time of the response. |
| `error` | string | Set when success is false. |

---

## Authentication

All requests require an API key:

```http
Authorization: Bearer YOUR_SPECTRE_POSTING_API_KEY
```

Or:

```http
X-API-Key: YOUR_SPECTRE_POSTING_API_KEY
```

Set `SPECTRE_POSTING_API_KEY` in the environment (or in Spectre’s .env) and use it when calling the API.

---

## Dry-run (generate only)

Generate post text without publishing. Use this to preview or iterate before publishing.

**Request:**

```http
POST /api/v1/posts/dry-run
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "topic": "BTC at 78K support",
  "tickers": ["BTC"],
  "constraints": { "tone": "pro", "non_ai_sounding": true, "no_overpromises": true },
  "format": "twitter",
  "sources": [],
  "disclaimers": "NFA"
}
```

**Response (200):**

```json
{
  "success": true,
  "post_text": "BTC testing 78K support. Level held so far; next 24h will tell. NFA.",
  "metadata": {
    "topic": "BTC at 78K support",
    "tickers": ["BTC"],
    "format": "twitter",
    "timestamp": "2025-01-31T21:00:00.000Z"
  },
  "post_id": null,
  "timestamp": "2025-01-31T21:00:00.000Z"
}
```

---

## Publish (create post)

Generate and persist a post; returns `post_id` and status.

**Request:**

```http
POST /api/v1/posts
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "topic": "BTC at 78K support",
  "tickers": ["BTC"],
  "constraints": { "tone": "pro", "non_ai_sounding": true, "no_overpromises": true },
  "format": "twitter",
  "sources": ["https://example.com/data"],
  "disclaimers": "NFA"
}
```

**Response (201):**

```json
{
  "success": true,
  "post_text": "BTC testing 78K support. Level held so far; next 24h will tell. NFA.",
  "metadata": { "topic": "BTC at 78K support", "tickers": ["BTC"], "format": "twitter" },
  "post_id": "post_abc123",
  "timestamp": "2025-01-31T21:00:00.000Z"
}
```

---

## Get post status

**Request:**

```http
GET /api/v1/posts/{id}
Authorization: Bearer YOUR_API_KEY
```

**Response (200):**

```json
{
  "id": "post_abc123",
  "status": "published",
  "post_text": "BTC testing 78K support...",
  "created_at": "2025-01-31T21:00:00.000Z"
}
```

---

## Health check

**Request:**

```http
GET /api/v1/health
```

**Response (200):** `{ "status": "ok", "service": "spectre-posting" }`

(No auth required for health.)

---

## Error handling and logging

- The API logs every request and response (no PII in logs; request IDs for tracing).
- On failure it returns appropriate HTTP status (400 validation, 401 auth, 429 rate limit, 500 server).
- Retries: client should retry on 5xx or network errors with backoff (e.g. 1s, 2s, 4s).
- Rate limits: configurable per API key (e.g. 60/min). Response includes `Retry-After` when limited.

---

## Content rules (constraints)

- **Tone:** Pro, hedge-fund style. No hype or meme slang unless requested.
- **Non–AI sounding:** Avoid generic filler (“It’s important to note”, “In conclusion”). Prefer concrete levels and timeframes.
- **No overpromises:** No price targets or guarantees. Use “watching”, “level to hold”, “next 24h will tell”, “NFA” where appropriate.
- **Disclaimers:** If provided, include or reference them (e.g. NFA, not financial advice).

---

## Skill usage in Cursor

1. Ensure the Spectre server is running and the Posting API is mounted at `/api/v1`.
2. Set `SPECTRE_POSTING_API_KEY` in `.env` (or in the environment where the skill runs).
3. For **dry-run**: call `POST /api/v1/posts/dry-run` with topic, tickers, constraints, format; use the returned `post_text` to edit or approve.
4. For **publish**: call `POST /api/v1/posts` with the same payload; store `post_id` and use `GET /api/v1/posts/{id}` to check status.
5. On errors, check status code and `error` in the body; retry with backoff on 5xx.

---

## OpenAPI spec

Full request/response schemas, auth, and validation are in:

**File:** `docs/spectre-posting-api-openapi.yaml`

Use it for code generation, client SDKs, or API docs (e.g. Swagger UI).
