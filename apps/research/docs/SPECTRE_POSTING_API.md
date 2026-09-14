# Spectre Posting API

Generate and publish crypto content (X/Twitter-style posts, Telegram announcements, short headlines) via the Spectre Posting API. Used by the **spectre_posting_skill** for Cursor/Claude.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check (no auth) |
| POST | `/api/v1/posts/dry-run` | Generate only; no persistence |
| POST | `/api/v1/posts` | Create and persist post |
| GET | `/api/v1/posts/:id` | Get post status |

## Authentication

- **Bearer:** `Authorization: Bearer YOUR_API_KEY`
- **Header:** `X-API-Key: YOUR_API_KEY`

Set `SPECTRE_POSTING_API_KEY` (or `SPECTRE_API_KEY`) in `.env`. If unset, the server accepts any token (dev only).

## Request body (POST /posts and /posts/dry-run)

```json
{
  "topic": "BTC at 78K support",
  "tickers": ["BTC"],
  "constraints": { "tone": "pro", "non_ai_sounding": true, "no_overpromises": true },
  "format": "twitter",
  "sources": [],
  "disclaimers": "NFA"
}
```

- **topic** (required): subject of the post.
- **tickers**: optional array of symbols (e.g. `["BTC","ETH"]`).
- **format**: `twitter` | `telegram` | `headline` (default `twitter`).
- **constraints**: optional tone and style flags.
- **sources** / **disclaimers**: optional.

## Response

- **200 (dry-run)** / **201 (post):** `{ success, post_text, metadata, post_id?, timestamp }`
- **400:** validation error.
- **401:** invalid or missing API key.
- **429:** rate limit (use `Retry-After` header).
- **500:** server error.

## Persistence

Posts are stored in `server/data/posts.json` (created automatically). To use SQLite instead, replace `server/db/posts-store.js` with a driver that implements `createPost` and `getPostById`.

## OpenAPI (Swagger)

Full spec: **docs/spectre-posting-api-openapi.yaml**

Use with Swagger UI or any OpenAPI 3.0 client.

## Skill

Cursor/Claude skill: **docs/spectre_posting_skill.md**
