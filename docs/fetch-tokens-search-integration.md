# Fetch Tokens Search Integration

## Scope

This change set focuses on the token search flow and Research Zone token resolution on the `engineering` line.

Implemented:

- Unified crypto search around `GET /fetch_tokens`
- Removed the old client-side fallback path to Codex and onchain search for token lookup
- Standardized the internal `/api/search/tokens` response shape
- Added explicit frontend handling for loading, too-short, empty, and error states
- Preserved token identity when navigating into Research Zone so refreshes and canonical slug redirects keep the selected token context

Not included:

- Additional endpoint integrations beyond token search and Research Zone token routing
- Changes to unrelated generated content under `packages/server/content/`

## Search Flow

Frontend token search now uses a single source of truth:

1. The UI calls `useTokenSearch()`
2. `useTokenSearch()` requests `/api/search/tokens?query=...`
3. The local proxy forwards that request to:

   `https://appresearchbeta-277369611639.us-central1.run.app/fetch_tokens?query=...`

4. The proxy normalizes the upstream payload into:

   - `query`
   - `results`
   - `error`
   - `meta`

5. The hook maps each token row into the frontend token shape used by the search UI

## UX Changes

- Queries shorter than 2 characters are treated as too short instead of showing a confusing empty result
- Desktop and mobile search both surface:
  - loading
  - too short
  - empty
  - backend error
- Popular queries still prewarm the cache for faster first search interactions

## Research Zone Routing

Research Zone navigation now carries token context in the URL search string:

- `tokenSymbol`
- `name`
- `cgId`
- `tokenId`
- `address`
- `networkId`

This allows the app to restore the intended token after:

- refresh
- deep linking
- canonical slug redirects
- internal slug corrections

## Main Files Updated

- `apps/research/src/hooks/useCodexData.js`
- `apps/research/src/components/header.jsx`
- `apps/research/src/components/mobile-search-overlay.jsx`
- `apps/research/src/components/layouts/app-shell.jsx`
- `apps/research/src/pages/research-zone/index.jsx`
- `apps/research/src/pages/research-zone/components/research-zone-lite.jsx`
- `apps/research/src/lib/research-zone-routing.js`
- `packages/server/index.js`
- `apps/research/api/_lib/handlers/search-api.js`

## Verification

Validated with:

- production build: `NODE_OPTIONS=--max-old-space-size=4096 npm run build:research`

The build completed successfully after increasing the Node heap size for this repo's large bundle.
