---
name: x-dash-frontend-handoff
description: Use this when building a frontend against the deployed X Dash API. Explains each product component, which endpoint it uses, which fields it displays, and how to recreate the same UI behavior without relying on internal repo structure.
---

# X Dash Frontend Handoff

This is a consumer-facing frontend handoff.

It should help a dev or agent answer:
- what screens exist
- what each component shows
- which endpoint powers it
- which fields matter
- how to recreate the same behavior simply

## API Base

Use this base URL:

```text
https://x-dash-api-277369611639.us-central1.run.app
```

Authentication:

```http
x-api-key: <YOUR_API_KEY>
```

Discovery endpoints:
- `/`
- `/openapi.json`
- `/api/manifest`

Main data endpoints:
- `/api/bootstrap`
- `/api/search`
- `/api/token/{cg_id}`
- `/api/category-chatter`
- `/api/category-momentum`
- `/api/category-tokens`

## Product Structure

The frontend has 4 main product surfaces:

1. Main dashboard
2. Category explorer
3. Token inspector
4. Signal OS

There is also an internal admin surface, but it is not part of the public consumer handoff.

## Main Dashboard

The main dashboard is built from one primary leaderboard payload and one selected-token detail payload.

### Main request

Use:

```http
GET /api/bootstrap?page=1&per_page=10&timeframe=24h&ranking=mentions&segment=all&market=all&min_kols=1
```

This returns the board payload used for:
- the hero
- majors rail
- main leaderboard
- health strip
- summary badges

### Important `bootstrap` fields

Use these parts of the response:
- `generated_at_utc`
- `mention_count`
- `token_count`
- `featured_majors`
- `tokens`
- `pagination`
- `totals`
- `health`
- `run_lock`

## Dashboard Components

### 1. Hero / Current Edge

Purpose:
- highlight the selected token or current board leader

Use fields from the selected `TokenEntry`:
- `token.name`
- `token.cashtag` or `token.symbol`
- `metrics.external_mentions_24h`
- `metrics.external_weighted_engagement_24h`
- `metrics.velocity_ratio`
- `latest_mention_at`

Behavior:
- if no token is selected, use the first leader from the current board
- change the headline depending on ranking mode:
  - `mentions` -> breadth/community framing
  - `momentum` -> surge/velocity framing
  - `conviction` -> quality/engagement framing

### 2. Filters Toolbar

Purpose:
- control the leaderboard query

Mappings:
- `Timeframe`
  - `24h` or `7d`
- `Ranking`
  - `Community` -> `ranking=mentions`
  - `Momentum` -> `ranking=momentum`
  - `Conviction` -> `ranking=conviction`
- `Market`
  - maps to `market`
- `Scope`
  - maps to `segment`
- `KOL floor`
  - maps to `min_kols`
- `Search`
  - switches from `/api/bootstrap` to `/api/search?q=...`

### 3. Health Strip

Purpose:
- show whether the system is fresh and healthy

Use:
- `generated_at_utc`
- `selection.rehydration`
- `health`
- `run_lock`

Display:
- board update time
- hydration summary
- whether pipeline activity or lock is currently present

### 4. Majors Rail

Source:
- `featured_majors`

Purpose:
- left-side list of major tokens

Display per row:
- rank
- token image
- cashtag or symbol
- token name
- token id
- mentions
- weighted engagement

Interaction:
- clicking a major selects that token for the inspector

### 5. Main Leaderboard

Source:
- `tokens`

Purpose:
- main ranked opportunity list

Display per row:
- rank
- token image
- cashtag or symbol
- token name
- token id
- market cap
- freshness
- authors
- mentions
- weighted engagement
- top author avatars
- small “why it matters” tags

Recommended field usage:
- authors -> `unique_external_authors_24h` or `unique_external_authors`
- mentions -> `external_mentions_24h` or `external_mentions`
- weighted -> `external_weighted_engagement_24h` or `external_weighted_engagement`
- freshness -> `latest_mention_at`
- top authors -> `top_authors`

### 6. Board Preview Cards

Purpose:
- compact summary of the first few ranked tokens

Source:
- first 3 items from `tokens`

Display:
- token
- scheduler tier if available
- authors
- mentions
- weighted
- small tags

These are not a separate API resource. They are just a compact rendering of the same board payload.

## Search Behavior

Use:

```http
GET /api/search?q=spectre-ai&page=1&per_page=10&timeframe=24h&segment=all&market=all&min_kols=1
```

Behavior:
- use the same UI structure as the main leaderboard
- only the data source changes
- the response shape is intentionally close to `/api/bootstrap`

## Category Layer

There are 2 category modes:
- `Category Chatter`
- `Category Momentum`

There are also 2 category scopes:
- `primary`
- `all`

### Category Chatter

Use:

```http
GET /api/category-chatter?page=1&per_page=8&timeframe=24h&category_scope=primary
```

Purpose:
- show where social attention is clustering by category

Display per category:
- category name
- token count
- mention count
- author count
- weighted engagement
- average clean signal
- top tokens
- freshness

### Category Momentum

Use:

```http
GET /api/category-momentum?page=1&per_page=8&timeframe=24h&category_scope=primary
```

Purpose:
- show which categories are accelerating fastest

Display per category:
- category name
- token count
- mention count
- author count
- weighted engagement
- momentum score
- top tokens
- freshness

## Explore All Categories

This is a 2-panel flow:

1. category list
2. selected category token list

### Category list

Source:
- `/api/category-chatter` or `/api/category-momentum`
- usually fetched with a large `per_page`, for example `1000`

Purpose:
- full category directory

Recommended chatter ordering:
1. `weighted_engagement`
2. `average_clean_signal`
3. `mention_count`
4. `author_count_sum`

Recommended momentum ordering:
1. `score_sum`
2. `weighted_engagement`
3. `mention_count`
4. `author_count_sum`

Display per row:
- category name
- token count
- primary metric
  - chatter -> weighted engagement
  - momentum -> momentum score
- secondary metric
  - chatter -> signal percentage + mentions
  - momentum -> weighted engagement

### Selected category summary

Source:
- selected category row

Display:
- category name
- token count
- mentions
- authors
- weighted engagement
- signal or momentum
- freshness
- scope

### Tokens inside selected category

Use:

```http
GET /api/category-tokens?category=Solana%20Ecosystem&mode=chatter&timeframe=24h&market=all&min_kols=1&category_scope=primary&page=1&per_page=40
```

Purpose:
- show the ranked tokens inside one category

Display per token:
- rank inside category
- token image
- cashtag or symbol
- token name
- market cap
- authors
- mentions
- weighted engagement

Important:
- do not fake this by calling `/api/bootstrap` and filtering locally
- use `/api/category-tokens`

## Token Inspector

The token inspector is the second major pillar of the product.

Use:

```http
GET /api/token/{cg_id}
```

Example:

```http
GET /api/token/spectre-ai
```

This powers:
- selected token header
- why-it-ranks summary
- metric grid
- live feed
- top feed
- author constellation
- author list

### Inspector header

Use:
- token identity
- segment
- market cap
- novelty
- scheduler tier if present

### Why it ranks

Use:
- mentions
- authors
- weighted engagement
- novelty ratio
- velocity ratio
- concentration hints from `quality`

This section is mostly copy derived from the metrics, not a separate API field.

### Metric grid

Use:
- `external_mentions_24h`
- `external_mentions`
- `unique_external_authors_24h`
- `external_weighted_engagement_24h`
- `external_weighted_engagement`
- `velocity_ratio`
- `novelty_ratio`

## Live Feed

Source:
- `mentions`
- `top_mentions`

Modes:
- `Recent`
  - use `mentions`
- `Top`
  - use `top_mentions`
  - if unavailable, sort mentions by weighted engagement as a fallback

Display per mention:
- author tier
- token symbol
- timestamp
- author handle
- tweet text
- outbound X link
- weighted engagement
- likes
- replies
- views

## Author Constellation

Purpose:
- visualize the authors carrying the signal

Source:
- `authors`
- fallback to `top_authors` if full author detail is not loaded yet

Modes:
- `recent`
- `full`

Behavior:
- selecting an author filters the feed to that author
- opening full mode should fetch the expanded author set

Use:

```http
GET /api/token/{cg_id}?author_scope=all
```

If one author is selected:

```http
GET /api/token/{cg_id}?author_scope=all&author_id=<rest_id>
```

## Empty Detail Recovery

Sometimes a token has summary metrics but the detail feed comes back empty.

Recovery path:

```http
GET /api/token/{cg_id}?force=1
```

Use this only when:
- mentions and authors are unexpectedly empty
- the summary suggests the token clearly has signal

Do not use `force=1` for all browsing. It is a recovery path, not a normal path.

## Signal OS

Signal OS is a visual systems page, not a normal leaderboard.

It is built from:
- 3 leaderboard calls
  - `ranking=mentions`
  - `ranking=momentum`
  - `ranking=conviction`
- one token detail call for each chosen showcase lead

Purpose:
- explain the pipeline
- compare the 3 ranking lenses
- attach real live examples to the system story

If recreating Signal OS elsewhere:
- preload those 3 boards first
- choose one lead token per board
- then load detail for each lead token

## Minimal Rebuild Recipes

### Rebuild the public dashboard

1. Call `/api/bootstrap`
2. render:
- hero
- health strip
- majors rail
- main leaderboard
3. choose initial selected token from:
- first `featured_majors`, otherwise first `tokens`
4. call `/api/token/{cg_id}`
5. render:
- inspector
- live feed
- author map

### Rebuild the category explorer

1. call `/api/category-chatter` or `/api/category-momentum`
2. sort the category list as described above
3. when a category is chosen, call `/api/category-tokens`
4. render:
- category summary
- ranked tokens in category

### Rebuild the same search UX

1. start with `/api/bootstrap`
2. when the user types a search term, switch to `/api/search?q=...`
3. keep the same leaderboard layout

## Keep It Simple

If another team is rebuilding the frontend, they only need to think in terms of:

1. leaderboard payload
2. category payload
3. category token payload
4. token detail payload

Everything else in the UI is a presentation layer on top of those 4 data shapes.

## Common Mistakes

Avoid these:
- building against a local API instead of the deployed API
- trying to infer category membership from `/api/bootstrap`
- defaulting every token detail request to `force=1`
- treating the category list as mention-only ordering
- ignoring `featured_majors`
- rebuilding the token inspector without using `/api/token/{cg_id}`

## Minimal Client Pattern

```ts
const API_BASE = 'https://x-dash-api-277369611639.us-central1.run.app';

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'x-api-key': process.env.X_DASH_API_KEY!,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`API failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

