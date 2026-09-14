# API Endpoints Documentation

This document describes the HTTP endpoints exposed by [`app.py`](/Users/haitam/PycharmProjects/SE_BACKEND/0_ANewApp_backend/app.py).

## Base URLs

- Production: `https://appresearchbeta-277369611639.us-central1.run.app`
- Local development: `http://127.0.0.1:8080`

## Common Notes

- All responses are JSON.
- Unless otherwise stated, endpoints use `GET`.
- Some endpoints depend on external providers such as CoinGecko, Defined, CoinMarketCap, Gemini, Firebase, and RSS feeds.
- For `/get-token-market-profile` and `/market-scenario`, provide exactly one identifier:
  - `cg_id`
  - `codex_id`

## 1. Health Check

### `GET /`

**What it does**

Simple service health endpoint.

**Params**

None.

**Expected result**

```json
"OK"
```

## 2. Token Search

### `GET /fetch_tokens`

**What it does**

Searches tokens across Defined and CoinGecko, merges duplicates, and returns a unified token list sorted by market cap.

**Params**

- `query` required string

**Expected result**

```json
[
  {
    "price": 0.325818,
    "token_id": "spectre-ai",
    "name": "Spectre AI",
    "ticker": "SPECTRE",
    "market_cap": 3255899,
    "chain": "ethereum",
    "change_1h": 0.05,
    "contract_address": "0x...",
    "volume": 83932,
    "cg_id": "spectre-ai",
    "logo": "https://..."
  }
]
```

**Errors**

- `400` if `query` is missing
- `502` if upstream token sources fail and no merged results are available

## 3. Token Market Profile

### `GET /get-token-market-profile`

**What it does**

Builds a complete token profile by combining Defined and CoinGecko. It also enriches the result with holders, liquidity structure, AI insight, and intelligence analysis.

**Params**

- `cg_id` optional string
- `codex_id` optional string

Exactly one of `cg_id` or `codex_id` must be provided.

**Expected result**

```json
{
  "token_details": {
    "token_name": "Spectre AI",
    "ticker": "SPECTRE",
    "image": "https://...",
    "banner": null,
    "description": "Token description",
    "holders": 8213,
    "price": 0.325818,
    "market_cap": 3255899,
    "liquidity": 173603,
    "volume_24h": 83932,
    "fully_diluted_valuation": 3255899,
    "circulating_supply": 9993171.20,
    "categories": ["Artificial Intelligence (AI)"],
    "vol_mkt_cap_ratio": 0.025778,
    "liquiditydata": {
      "liquidity": 173603,
      "volume24h": 83932,
      "volume24hUsd": 83932,
      "marketCapUsd": 3255899,
      "volMktCapRatio": 0.025778,
      "numberOfExchanges": 2,
      "numberOfPairs": 2,
      "spread": 1.217665,
      "buySideDepth": 7724,
      "sellSideDepth": 7733,
      "cexDexSplit": {
        "cexPairs": 1,
        "dexPairs": 0,
        "cexVolume24hUsd": 72733,
        "dexVolume24hUsd": null,
        "cexShare": 1.0,
        "dexShare": 0.0
      }
    },
    "price_performance": {
      "low_24h": 0.317909,
      "high_24h": 0.328562,
      "change_1h": 0.059,
      "change_7d": 0.7355,
      "change_30d": -13.19,
      "all_time_low": {
        "price": "$0.03",
        "date": "Dec 30, 2023",
        "change_percentage": "+1031.62%"
      },
      "all_time_high": {
        "price": "$11.04",
        "date": "Aug 19, 2025",
        "change_percentage": "-97.05%"
      }
    },
    "key_levels": {
      "support": 0.31,
      "resistance": 0.33
    },
    "ai_insight": "Short market commentary"
  },
  "intelligence_ai_analysis": {
    "sentiment_score": 4.0,
    "label": "Neutral",
    "fear_greed": {
      "classification": "Fear",
      "value": 30
    },
    "overall_trend": "Neutral"
  }
}
```

**Errors**

- `400` if neither or both identifiers are provided
- `404` if no token is found
- `500` if required env vars are missing
- `502` if upstream token providers fail

## 4. Market Scenario

### `GET /market-scenario`

**What it does**

Fetches the same shared token profile used by `/get-token-market-profile`, then generates a market-scenario card for the token using heuristic logic or Gemini plus fallback.

**Params**

- `cg_id` optional string
- `codex_id` optional string
- `mode` optional string

Allowed `mode` values:

- `fast`
- `full`

Exactly one of `cg_id` or `codex_id` must be provided.

**Expected result**

```json
{
  "success": true,
  "token": "SPECTRE",
  "token_name": "Spectre AI",
  "market_scenario": {
    "scenario_title": "Consolidation Phase",
    "confidence": 60,
    "summary": "Price is trading between support and resistance while sentiment remains balanced.",
    "bull_case": "A break above resistance with stronger participation would improve the structure.",
    "bear_case": "Failure to hold support would increase downside risk.",
    "range_high": 0.33,
    "range_low": 0.31,
    "bias": "neutral",
    "risk_level": "medium"
  }
}
```

**Errors**

- `400` for invalid `mode` or invalid identifier usage
- `404` if the token profile cannot be resolved
- `500` for runtime failures

## 5. Token Fundamentals

### `POST /token-fundamuntals`

**What it does**

Generates a fundamentals grading object from frontend-supplied token data. This endpoint expects the same payload shape returned by `/get-token-market-profile`.

**Request body**

JSON object containing:

- `token_details` required object
- `intelligence_ai_analysis` optional object
- `config` optional object

Optional `config` fields:

- `gemini_model`
- `output_path`

**Example request**

```json
{
  "token_details": {
    "token_name": "Spectre AI",
    "ticker": "SPECTRE",
    "liquiditydata": {
      "liquidity": 173603,
      "volume24hUsd": 83932,
      "marketCapUsd": 3255899,
      "volMktCapRatio": 0.025778
    }
  },
  "intelligence_ai_analysis": {
    "label": "Neutral",
    "overall_trend": "Neutral",
    "sentiment_score": 4.0
  }
}
```

**Expected result**

```json
{
  "overallGrade": {
    "score": 78,
    "letter": "B+"
  },
  "fundamentals": [
    {
      "key": "liquidity",
      "label": "Liquidity",
      "score": 74,
      "letter": "B"
    }
  ],
  "summary": "Short token fundamentals summary.",
  "positiveTags": [
    "Positive signal 1",
    "Positive signal 2",
    "Positive signal 3"
  ],
  "riskTags": [
    "Risk factor 1",
    "Risk factor 2",
    "Risk factor 3"
  ]
}
```

**Errors**

- `400` if the request body is not a JSON object or `token_details` is invalid
- `500` if runtime generation fails

## 6. Fear & Greed

### `GET /welcome/fear-greed`

**What it does**

Returns the cached Fear & Greed history snapshot used by the app.

**Params**

- `browser` optional boolean-like flag

Accepted truthy values:

- `1`
- `true`
- `yes`
- `on`

**Expected result**

```json
{
  "fetched_at": "2026-04-05T12:00:00+00:00",
  "current": {
    "value": 30,
    "classification": "Fear"
  },
  "yesterday": {
    "value": 31,
    "classification": "Fear"
  },
  "last_week": {
    "value": 42,
    "classification": "Neutral"
  },
  "last_month": {
    "value": 55,
    "classification": "Greed"
  },
  "historical_values": {
    "current": {},
    "yesterday": {},
    "last_week": {},
    "last_month": {}
  },
  "yearly_high": {
    "value": 80,
    "classification": "Greed"
  },
  "yearly_low": {
    "value": 12,
    "classification": "Extreme Fear"
  }
}
```

**Errors**

- `502` if upstream market sentiment fetch fails
- `500` for runtime errors

## 7. Crypto Sectors

### `GET /welcome/sectors`

**What it does**

Returns crypto sectors from CoinGecko after removing stablecoin sectors and prioritizing AI sectors at the top.

**Params**

- `order` optional string
- `sector_limit` optional integer
- `limit` optional integer

Allowed `order` values:

- `market_cap_desc`
- `market_cap_asc`
- `name_desc`
- `name_asc`
- `market_cap_change_24h_desc`
- `market_cap_change_24h_asc`

If both `sector_limit` and `limit` are present, `sector_limit` is used first.

**Expected result**

```json
{
  "count": 20,
  "order": "market_cap_desc",
  "cached_at": "2026-04-05T12:00:00+00:00",
  "source_updated_at": "2026-04-05T11:58:00.000Z",
  "sectors": [
    {
      "sector_id": "artificial-intelligence",
      "sector_name": "Artificial Intelligence (AI)",
      "change_24h": 4.25,
      "performance": "strong",
      "volume": 1234567890,
      "lifecycle": "growth"
    }
  ]
}
```

**Errors**

- `400` for invalid `order` or invalid limit
- `502` if CoinGecko sector fetch fails
- `500` if config is missing

## 8. Sector Top Movers

### `GET /welcome/sectors/top-movers`

**What it does**

Returns one of two modes:

- without `sector_id`: one top mover from each top sector
- with `sector_id`: top gainers and top losers for that specific sector

**Params**

- `sector_id` optional string
- `vs_currency` optional string, default `usd`
- `sector_limit` optional integer, used when `sector_id` is not provided
- `limit` optional integer, used when `sector_id` is provided

**Expected result without `sector_id`**

```json
{
  "vs_currency": "usd",
  "sector_count": 20,
  "source_updated_at": "2026-04-05T11:58:00.000Z",
  "cached_at": "2026-04-05T12:00:00+00:00",
  "top_movers": [
    {
      "sector_id": "artificial-intelligence",
      "sector_name": "Artificial Intelligence (AI)",
      "change_24h": 4.25,
      "performance": "strong",
      "volume": 1234567890,
      "lifecycle": "growth",
      "top_mover": {
        "token_id": "spectre-ai",
        "name": "Spectre AI",
        "ticker": "SPECTRE",
        "logo": "https://...",
        "price": 0.325818,
        "change_24h": 12.4,
        "market_cap": 3255899,
        "volume": 83932,
        "market_cap_rank": 1234,
        "last_updated": "2026-04-05T11:59:00.000Z"
      }
    }
  ]
}
```

**Expected result with `sector_id`**

```json
{
  "sector_id": "artificial-intelligence",
  "sector_name": "Artificial Intelligence (AI)",
  "vs_currency": "usd",
  "count": 150,
  "cached_at": "2026-04-05T12:00:00+00:00",
  "top_gainers": [],
  "top_losers": []
}
```

**Errors**

- `400` for invalid limits
- `404` for unknown `sector_id`
- `502` if CoinGecko mover fetch fails
- `500` if config is missing

## 9. Sector AI Analysis

### `GET /welcome/sectors/ai-analysis`

**What it does**

Builds a top-sector snapshot and uses Gemini to return short market commentary sections for the sector landscape.

**Params**

- `vs_currency` optional string, default `usd`
- `sector_limit` optional integer

**Expected result**

```json
{
  "vs_currency": "usd",
  "sector_count": 20,
  "cached_at": "2026-04-05T12:00:00+00:00",
  "source_updated_at": "2026-04-05T11:58:00.000Z",
  "market_context": {
    "top_sector": {
      "sector_name": "Artificial Intelligence (AI)",
      "change_24h": 4.25
    },
    "weakest_sector": {
      "sector_name": "Memes",
      "change_24h": -3.1
    },
    "volume_leader": {
      "sector_name": "Layer 1 (L1)",
      "volume": 9300000000,
      "volume_display": "$9.3B",
      "volume_share": "+34.00%"
    },
    "dispersion_spread": 8.0,
    "dispersion_display": "+8.00%",
    "positive_sector_count": 7,
    "negative_sector_count": 2,
    "total_volume": 27000000000,
    "total_volume_display": "$27.0B"
  },
  "AI Analysis": "Short AI market summary.",
  "Volume Flow": "Short volume interpretation.",
  "Sector Dispersion": "Short dispersion interpretation.",
  "Positioning": "Short positioning interpretation.",
  "top_movers": []
}
```

**Errors**

- `400` for invalid limits
- `502` if sector data collection or Gemini generation fails
- `500` if config is missing

## 10. RSS News

### `GET /news/rss`

**What it does**

Aggregates multiple crypto RSS feeds, deduplicates them, and optionally filters by symbol.

**Params**

- `symbol` optional string such as `BTC`, `ETH`, `SOL`
- `limit` optional integer, default `10`, max `20`

**Expected result**

```json
{
  "results": [
    {
      "id": "rss-1234567890abcdef",
      "title": "Headline",
      "url": "https://example.com/article",
      "summary": "Short article summary",
      "source": "CoinDesk",
      "imageUrl": "https://...",
      "publishedOn": 1770000000,
      "publishedAt": "2026-04-05T12:00:00Z",
      "categories": ["Bitcoin"]
    }
  ]
}
```

## 11. Dashboard AI Market

### `GET /dashboard_ai_market`

**What it does**

Returns the latest AI market dashboard snapshot stored in Firebase at `/ainalyse/latest`.

**Params**

None.

**Expected result**

The JSON object stored in Firebase. Shape depends on the current stored document.

## 12. Dashboard AI Market Text

### `GET /dashboard_ai_market_text`

**What it does**

Returns either the latest saved market-analysis text or the snapshot history from Firebase.

**Params**

- `s` optional flag

If `s` is present in the query string, the endpoint returns snapshots from `/analysis/snapshots`.
Otherwise it returns the latest analysis from `/analysis/latest/json`.

**Expected result**

```json
{
  "success": true,
  "source": "latest",
  "data": {}
}
```

or

```json
{
  "success": true,
  "source": "snapshots",
  "data": {}
}
```

**Errors**

- `404` if no saved analysis exists
- `500` for Firebase/runtime errors

## 13. Welcome X Tweets

### `GET /welcome_x_tweet`

**What it does**

Returns the latest tweets payload stored in Firebase at `/aut_tweets/latest_tweets`.

**Params**

None.

**Expected result**

The JSON object stored in Firebase for the latest tweets snapshot.

## 14. Mindshare Narratives

### `GET /narratives/mindshare`

**What it does**

Builds a narrative lifecycle and sector-mindshare snapshot based on sector movers and optional X/Twitter social context.

**Params**

All params are optional.

- `cache_ttl_seconds`
- `refresh_interval_minutes`
- `include_social`
- `queries_per_sector`
- `x_handle_limit`
- `tweet_count`
- `max_workers`
- `search_type`
- `min_engagement_score`
- `min_follower_count`
- `min_interactions`
- `force_refresh`
- `x_handles` comma-separated handles

**Expected result**

```json
{
  "generated_at": "2026-04-05T12:00:00Z",
  "source": {
    "sector_endpoint": "https://...",
    "sector_cached_at": "2026-04-05T11:59:00Z",
    "sector_source_updated_at": "2026-04-05T11:58:00Z",
    "sector_count": 20,
    "vs_currency": "usd"
  },
  "query": {},
  "x_queries": [],
  "cycle": {},
  "highlights": {},
  "stage_legend": [],
  "request_budget": {},
  "social": {},
  "curve": {
    "type": "narrative_lifecycle_proxy",
    "bubble_metric": "volume",
    "items": []
  },
  "matrix": {
    "sort": "momentum_score_desc",
    "rows": []
  },
  "sectors": [],
  "cache": {
    "hit": true,
    "age_seconds": 12.3,
    "ttl_seconds": 3600,
    "created_at": "2026-04-05T12:00:00Z"
  }
}
```

**Errors**

- `500` if the narrative snapshot build fails
