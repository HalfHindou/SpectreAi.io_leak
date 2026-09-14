---
description: Query PostHog analytics - event counts, active users, top events, session stats
argument-hint: "[question about your analytics data]"
---

Query Spectre AI's PostHog analytics to answer: $ARGUMENTS

## PostHog Project Details
- **Dashboard**: https://us.posthog.com/project
- **API host**: https://us.i.posthog.com
- **Project API key**: stored in `.env` as `VITE_POSTHOG_KEY`

## How to Query

### Option A: PostHog API (if personal API key available)
Check if `POSTHOG_PERSONAL_API_KEY` exists in `.env`. If yes, use curl:

```bash
# Example: Get event counts from last 7 days
curl -s -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
  "https://us.i.posthog.com/api/projects/@current/insights/trend/" \
  -d '{"events":[{"id":"$pageview"}],"date_from":"-7d"}'
```

Common queries:
- **Active users**: `/api/projects/@current/insights/trend/` with `$pageview` event
- **Top events**: `/api/projects/@current/insights/trend/` grouped by event name
- **Session count**: `/api/projects/@current/insights/trend/` with `$session` event
- **Feature usage**: query specific `Events.*` names from analytics.js

### Option B: Direct Dashboard (if no API key)
If no personal API key is configured, tell the user:
1. Go to https://us.posthog.com/ and sign in
2. Navigate to the relevant dashboard section
3. Suggest adding `POSTHOG_PERSONAL_API_KEY` to `.env` for CLI access:
   - Go to PostHog -> Settings -> Personal API Keys -> Create key

## Tracked Events (from analytics.js)
Both apps track these via `posthog.capture()`:
- Search, Sign In, Token Viewed, Watchlist Action
- Settings Changed, Content Shared, Chart Interaction
- Compare Used, Profile Updated, Cinema Mode Toggled
- PWA Installed, Swap Started, Launch AI
- AI Dismissed, AI Prompt Sent, AI Response Sent, Error

## Auto-captured by PostHog
- `$pageview` (every route change via `history_change` mode)
- `$pageleave` (session end timing)
- `$autocapture` (clicks, form submits)
- Web Vitals (LCP, FID, CLS via `capture_performance: true`)
- Session recordings (if enabled in dashboard)

## Group Analytics
Events are grouped by `app` property: `research` or `trading`. Use this to compare metrics between apps.
