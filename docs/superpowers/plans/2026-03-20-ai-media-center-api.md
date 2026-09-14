# AI Media Center — API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static hardcoded media center with live API-fed content from YouTube Data API v3, Twitch Helix, and Podcast Index — plus a new Channels directory tab.

**Architecture:** Server-side Express routes proxy all external API calls (YouTube, Twitch, Podcast Index) with in-memory caching. Frontend service layer (`mediaApi.js`) calls `/api/media/*` endpoints. Zustand store holds per-tab data + user state. A parallel Vercel serverless function handles production. Curated channel lists live in a JSON seed file on the server.

**Tech Stack:** Express.js (server routes), Vercel serverless functions, YouTube Data API v3, Twitch Helix API, Podcast Index API, React 18 + Zustand v5, plain CSS

**Spec:** `docs/superpowers/specs/2026-03-19-ai-media-center-api-design.md`

---

## File Structure

```
packages/server/
  routes/media.js                    (NEW — Express routes for all 3 APIs + channels)
  lib/media-helpers.js               (NEW — shared API logic used by Express + Vercel)
  data/crypto-channels.json          (NEW — curated YouTube + Twitch channel IDs)

apps/research/
  api/media.js                       (NEW — Vercel serverless function, imports from packages/server/lib/)
  src/services/mediaApi.js           (NEW — frontend API service)
  src/store/useMediaStore.js         (REWRITE — API-driven state + followedChannels)
  src/pages/media-center/
    components/
      media-center-page.jsx          (REWRITE — 8 API-driven tabs)
      media-center-page.css          (UPDATE — new card + tab styles)
      media-card.jsx                 (NEW — universal card for videos/live/clips)
      media-card.css                 (NEW)
      shorts-card.jsx                (NEW — vertical 9:16 card)
      shorts-card.css                (NEW)
      podcast-card.jsx               (NEW — episode card with audio)
      podcast-card.css               (NEW)
      channel-card.jsx               (NEW — channel directory card)
      channel-card.css               (NEW)
      live-badge.jsx                 (NEW — pulsing red LIVE indicator)
      media-tab-header.jsx           (NEW — tab title + refresh + timestamp)
      for-you-empty.jsx              (NEW — watchlist CTA empty state)
      media-center-data.js           (DELETE — replaced by API)
      theater-mode.jsx               (UPDATE — multi-source embed branching)
      mini-player.jsx                (UPDATE — multi-source + audio support)
      mini-player.css                (UPDATE — podcast audio bar styles)
      live-badge.css                 (NEW — pulsing red dot styles, standalone)
```

### Unified Media Item Model Addition

The spec's MediaItem model uses `url` for embed URLs. For Podcast Index items, add an `audioUrl` field (mapped from the API's `enclosureUrl`) for direct audio playback. Components use `item.audioUrl` for `<audio src>` on podcast-index items, and `item.url` for iframe embeds on YouTube/Twitch items.

---

## Task 1: Curated Channel Seed Data

**Files:**
- Create: `packages/server/data/crypto-channels.json`

This is the seed list of crypto channels. Server fetches live metadata from YouTube/Twitch APIs using these IDs.

- [ ] **Step 1: Create the channel seed file**

```json
{
  "youtube": [
    { "id": "UCqK_GSMbpiV8spgD3ZGloSw", "name": "Coin Bureau" },
    { "id": "UCRvqjQPSeaWn-uEx-w0XOIg", "name": "Benjamin Cowen" },
    { "id": "UCAl9Ld79qaZxp9JzEOwd3aA", "name": "Whiteboard Crypto" },
    { "id": "UCCatR7nWbYrkVXdxXb4cGXg", "name": "Raoul Pal" },
    { "id": "UCiUnrCUGCJTCC7KjuW493Ww", "name": "Brian Jung" },
    { "id": "UCWN3xxRkmTPphN_CjMiCqAg", "name": "Altcoin Daily" },
    { "id": "UCSzPmLWmN0yBV2JySHmP7Rg", "name": "DataDash" },
    { "id": "UCEvd7CuGiBMDReIFc_TVE1Q", "name": "Finematics" },
    { "id": "UCfOAhLGZ0ufH-3oYFTVLUTg", "name": "Bankless" },
    { "id": "UCu7Sre5A1NMV8J3s0Kylg2w", "name": "The Defiant" },
    { "id": "UCqK6OstTjBJMPH4m_yVgyBw", "name": "Real Vision" },
    { "id": "UCRp_FBBJCwHHn3dDjSMz2ig", "name": "Anthony Pompliano" },
    { "id": "UCvXjP6h0_4CSBPVgHkWbn6g", "name": "Trader University" },
    { "id": "UCX7oeQx7jimanGYNiB_UJ9Q", "name": "MoneyZG" },
    { "id": "UCZ6EPXQMRM2Q3Iy_-FxGZww", "name": "What Bitcoin Did" },
    { "id": "UCjpkws_GKEV3r0a34vTM3XQ", "name": "TradingLab" },
    { "id": "UCOGmLcknslrcnoHjLW4q3pA", "name": "BTC Sessions" },
    { "id": "UCJnKVGmXRXrH49Tvrn2X_3A", "name": "Crypto Banter" },
    { "id": "UC9_0qRbmVNJbOypsBZKCv9g", "name": "Into The Cryptoverse" },
    { "id": "UCnhdHPHVPH57TGiCSHTnMOw", "name": "Lark Davis" }
  ],
  "twitch": [
    { "login": "coindesk", "name": "CoinDesk" },
    { "login": "cryptocom", "name": "Crypto.com" },
    { "login": "theblock", "name": "The Block" },
    { "login": "blockworks_", "name": "Blockworks" },
    { "login": "crypto_banter", "name": "Crypto Banter" },
    { "login": "realtechreview", "name": "Real Tech Review" },
    { "login": "satoshiclub", "name": "Satoshi Club" },
    { "login": "binance", "name": "Binance" },
    { "login": "aaboronin", "name": "Crypto Trading" },
    { "login": "hustlehard5050", "name": "Hustle Hard Crypto" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/data/crypto-channels.json
git commit -m "feat(media): add curated crypto channel seed data"
```

---

## Task 2: Express Server — Media Routes

**Files:**
- Create: `packages/server/routes/media.js`
- Modify: `packages/server/index.js` (mount the route)

This task builds all server-side API routes: YouTube search/enrichment, Twitch OAuth + streams/clips, Podcast Index search/episodes, channels directory, and the For You feed. All routes use in-memory caching with TTLs per the spec.

- [ ] **Step 1: Create `packages/server/routes/media.js`**

The file implements:
- In-memory cache with TTL (`mediaCache` Map)
- YouTube helpers: `youtubeSearch(params)`, `youtubeVideoDetails(ids)`, `extractTokenTags(text)`
- Twitch helpers: `getTwitchToken()` (client credentials OAuth, auto-refresh), `twitchGet(endpoint, params)`
- Podcast Index helpers: `podcastIndexGet(endpoint, params)` (HMAC auth headers)
- Normalizers: `normalizeYouTubeItem(item, details)`, `normalizeTwitchStream(stream)`, `normalizeTwitchClip(clip)`, `normalizePodcast(episode, feed)` — the podcast normalizer maps `episode.enclosureUrl` to `audioUrl` in the unified model
- Routes:
  - `GET /youtube/videos` — search YouTube for crypto videos, enrich with `videos.list` for duration/stats
  - `GET /youtube/shorts` — search with `#shorts` appended, filter by duration <180s
  - `GET /youtube/live` — search with `eventType=live`, type=video
  - `GET /twitch/live` — `GET /streams` filtered by crypto game/category IDs
  - `GET /twitch/clips` — `GET /clips` from curated channel list
  - `GET /podcasts/search` — Podcast Index `/search/byterm`
  - `GET /podcasts/episodes` — Podcast Index `/episodes/byfeedid`
  - `GET /channels` — fetch live metadata for curated YouTube + Twitch channels
  - `GET /channels/youtube` — YouTube channels only
  - `GET /channels/twitch` — Twitch channels only
  - `GET /feed/for-you` — merges YouTube + Twitch + Podcast results filtered by user's token tags
- All routes return `{ items: [], meta: { source, cached, lastRefreshed, nextPage } }`
- `?refresh=true` query param bypasses cache

Key implementation details:

```js
const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const channelSeed = require('../data/crypto-channels.json')

/* ── In-memory cache ── */
const mediaCache = new Map()

function getCached(key, ttlMs) {
  const entry = mediaCache.get(key)
  if (!entry) return null
  const age = Date.now() - entry.timestamp
  return { data: entry.data, stale: age > ttlMs, age }
}

function setCache(key, data) {
  mediaCache.set(key, { data, timestamp: Date.now() })
}

/* ── TTLs (ms) ── */
const TTL = {
  ytVideos: 4 * 60 * 60 * 1000,
  ytShorts: 4 * 60 * 60 * 1000,
  ytLive: 5 * 60 * 1000,
  twLive: 2 * 60 * 1000,
  twClips: 4 * 60 * 60 * 1000,
  podSearch: 6 * 60 * 60 * 1000,
  podEpisodes: 6 * 60 * 60 * 1000,
  channels: 12 * 60 * 60 * 1000,
  forYou: 4 * 60 * 60 * 1000,
}
```

Token tag extraction matches video title + description against known major symbols:

```js
const MAJOR_SYMBOLS = new Set([
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','MATIC',
  'LINK','UNI','ATOM','FIL','APT','ARB','OP','SUI','SEI','TIA',
  'FET','RNDR','INJ','NEAR','AAVE','MKR','CRV','LDO','PEPE','WIF',
  'BONK','FLOKI','STX','ONDO','IMX','SAND','MANA','AXS','GRT','SNX',
])

function extractTokenTags(text) {
  if (!text) return []
  const upper = text.toUpperCase()
  return [...MAJOR_SYMBOLS].filter(sym => {
    const re = new RegExp(`\\b${sym}\\b|\\$${sym}\\b`, 'i')
    return re.test(upper)
  })
}
```

Twitch OAuth (client credentials):

```js
let twitchToken = null
let twitchTokenExpiry = 0

async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchTokenExpiry) return twitchToken
  const clientId = process.env.TWITCH_CLIENT_ID
  const clientSecret = process.env.TWITCH_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Twitch credentials not configured')
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
  })
  if (!res.ok) throw new Error(`Twitch OAuth failed: ${res.status}`)
  const data = await res.json()
  twitchToken = data.access_token
  twitchTokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return twitchToken
}
```

Podcast Index HMAC auth:

```js
function podcastIndexHeaders() {
  const apiKey = process.env.PODCAST_INDEX_KEY
  const apiSecret = process.env.PODCAST_INDEX_SECRET
  if (!apiKey || !apiSecret) throw new Error('Podcast Index credentials not configured')
  const ts = Math.floor(Date.now() / 1000)
  const hash = crypto.createHash('sha1').update(apiKey + apiSecret + ts).digest('hex')
  return {
    'X-Auth-Key': apiKey,
    'X-Auth-Date': String(ts),
    'Authorization': hash,
    'User-Agent': 'SpectreAI/1.0',
  }
}
```

- [ ] **Step 2: Mount the media route in `packages/server/index.js`**

Add near the other route mounts (~line 10895):

```js
const mediaRoutes = require('./routes/media')
app.use('/api/media', mediaRoutes)
```

- [ ] **Step 3: Test locally with curl**

Start the server: `npm run dev:server`

```bash
# YouTube videos (will fail gracefully if no YOUTUBE_API_KEY set)
curl -s http://localhost:3001/api/media/youtube/videos?q=crypto | jq '.meta'

# Channels
curl -s http://localhost:3001/api/media/channels | jq '.items | length'
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/routes/media.js packages/server/index.js
git commit -m "feat(media): add Express routes for YouTube, Twitch, Podcast Index, and Channels"
```

---

## Task 3: Vercel Serverless Function

**Files:**
- Create: `apps/research/api/media.js`
- Modify: `apps/research/vercel.json` (add rewrites)

Single serverless function that routes based on `source` + `type` query params. Mirrors the Express routes but uses module-level caching (survives warm instances).

- [ ] **Step 1: Create `apps/research/api/media.js`**

Pattern matches `cg-proxy.js`: CORS headers, OPTIONS handling, query param routing. Internally duplicates the API logic from the Express routes (YouTube fetch, Twitch OAuth, Podcast Index HMAC). The module-level cache (`Map`) persists within warm function instances.

Route mapping:
- `?source=youtube&type=videos&q=crypto` → YouTube video search
- `?source=youtube&type=shorts&q=crypto` → YouTube shorts search
- `?source=youtube&type=live` → YouTube live streams
- `?source=twitch&type=live` → Twitch live streams
- `?source=twitch&type=clips` → Twitch clips
- `?source=podcasts&type=search&q=crypto` → Podcast Index search
- `?source=podcasts&type=episodes&feedId=123` → Podcast episodes
- `?source=channels&type=all` → All channels
- `?source=channels&type=youtube` → YouTube channels only
- `?source=channels&type=twitch` → Twitch channels only
- `?source=feed&type=for-you&tokens=BTC,ETH` → Personalized feed

To avoid duplicating 500+ lines, shared API logic lives in `packages/server/lib/media-helpers.js`. The Express route imports it directly. The Vercel serverless function imports it via relative path (`../../packages/server/lib/media-helpers.js`) — this works because Vercel bundles the function at deploy time and follows relative imports.

**Important:** Do NOT put shared helpers in `apps/research/api/_lib/` — that would create a cross-app import violation when the Express server imports from it.

- [ ] **Step 2: Add rewrites to `apps/research/vercel.json`**

**CRITICAL:** Insert these BEFORE the catch-all `{ "source": "/(.*)", "destination": "/index.html" }` rewrite. Vercel processes rewrites in order — the catch-all would swallow these if placed after.

**CRITICAL:** Vercel rewrites do NOT auto-forward query params to the destination. The serverless function must read remaining params from `req.query` directly, since Vercel passes all original query params through to the function regardless of the rewrite destination URL. The `source` and `type` params are injected by the rewrite; everything else (`q`, `page`, `tokens`, `refresh`, `feedId`, `period`) comes through `req.query` as-is.

```json
{ "source": "/api/media/youtube/:type", "destination": "/api/media?source=youtube&type=:type" },
{ "source": "/api/media/twitch/:type", "destination": "/api/media?source=twitch&type=:type" },
{ "source": "/api/media/podcasts/:type", "destination": "/api/media?source=podcasts&type=:type" },
{ "source": "/api/media/feed/:type", "destination": "/api/media?source=feed&type=:type" },
{ "source": "/api/media/channels/:source", "destination": "/api/media?source=channels&type=:source" },
{ "source": "/api/media/channels", "destination": "/api/media?source=channels&type=all" }
```

- [ ] **Step 3: Commit**

```bash
git add apps/research/api/media.js packages/server/lib/media-helpers.js apps/research/vercel.json
git commit -m "feat(media): add Vercel serverless function, shared helpers, and rewrites for media API"
```

---

## Task 4: Frontend Service Layer

**Files:**
- Create: `apps/research/src/services/mediaApi.js`

Single service file with functions per endpoint. Follows the same pattern as `coinGeckoApi.js`: relative `/api` paths, AbortController timeouts, returns `{ items, meta }`.

- [ ] **Step 1: Create `apps/research/src/services/mediaApi.js`**

```js
/**
 * Media Center API Service
 * All calls go through /api/media/* — Vite proxy in dev, Vercel functions in prod
 */

const MEDIA_API = '/api/media'
const TIMEOUT = 10000

async function mediaFetch(path, params = {}) {
  const url = new URL(`${MEDIA_API}${path}`, window.location.origin)
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, v)
  })
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT)
  const res = await fetch(url.toString(), { signal: controller.signal })
  clearTimeout(timeoutId)
  if (!res.ok) throw new Error(`Media API error: ${res.status}`)
  return res.json()
}

export function getVideos(query = 'crypto', page) {
  return mediaFetch('/youtube/videos', { q: query, page })
}

export function getShorts(query = 'crypto', page) {
  return mediaFetch('/youtube/shorts', { q: query, page })
}

export function getLive() {
  return Promise.all([
    mediaFetch('/youtube/live').catch(() => ({ items: [], meta: { source: 'youtube' } })),
    mediaFetch('/twitch/live').catch(() => ({ items: [], meta: { source: 'twitch' } })),
  ]).then(([yt, tw]) => ({
    items: [...yt.items, ...tw.items].sort((a, b) => b.viewCount - a.viewCount),
    meta: { source: 'mixed', cached: yt.meta.cached || tw.meta.cached, lastRefreshed: new Date().toISOString() },
  }))
}

export function getClips(period = 'week') {
  return mediaFetch('/twitch/clips', { period })
}

export function getPodcasts(query = 'crypto') {
  return mediaFetch('/podcasts/search', { q: query })
}

export function getPodcastEpisodes(feedId) {
  return mediaFetch('/podcasts/episodes', { feedId })
}

export function getChannels(source = 'all') {
  const path = source === 'all' ? '/channels' : `/channels/${source}`
  return mediaFetch(path)
}

export function getForYou(tokens) {
  return mediaFetch('/feed/for-you', { tokens: tokens.join(',') })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/research/src/services/mediaApi.js
git commit -m "feat(media): add frontend mediaApi service layer"
```

---

## Task 5: Rewrite Zustand Store

**Files:**
- Rewrite: `apps/research/src/store/useMediaStore.js`

Add API-driven per-tab state (`items`, `loading`, `lastRefreshed`, `error`), pagination state, `followedChannels` (persisted). Preserve all existing playback/queue/playlist/saved/recentlyWatched actions.

- [ ] **Step 1: Rewrite `useMediaStore.js`**

**Note:** The spec uses nested objects (`items: { forYou: [], ... }`). This plan uses flat dynamic keys (`forYouItems`, `videosItems`, etc.) because Zustand selectors work better with flat keys — `s.videosLoading` is simpler and more performant than `s.loading.videos` which requires a custom equality check. This is an intentional deviation from the spec.

Key additions to existing store:

```js
// New tab names
const TABS = ['forYou', 'videos', 'shorts', 'live', 'clips', 'podcasts', 'channels']

// API-driven state (not persisted) — flat keys for efficient Zustand selectors
...TABS.reduce((acc, tab) => ({
  ...acc,
  [`${tab}Items`]: [],
  [`${tab}Loading`]: false,
  [`${tab}Error`]: null,
  [`${tab}LastRefreshed`]: null,
}), {}),

// Pagination (not persisted)
pagination: {
  videos: { nextPage: null, hasMore: true },
  shorts: { nextPage: null, hasMore: true },
  clips: { nextPage: null, hasMore: true },
  podcasts: { nextPage: null, hasMore: true },
},

// Persisted additions
followedChannels: [],

// New actions
setTabData: (tab, { items, meta }) => set({
  [`${tab}Items`]: items,
  [`${tab}Loading`]: false,
  [`${tab}Error`]: null,
  [`${tab}LastRefreshed`]: meta?.lastRefreshed || new Date().toISOString(),
  ...(meta?.nextPage !== undefined ? {
    pagination: { ...get().pagination, [tab]: { nextPage: meta.nextPage, hasMore: !!meta.nextPage } }
  } : {}),
}),

appendTabPage: (tab, { items, meta }) => set(s => ({
  [`${tab}Items`]: [...s[`${tab}Items`], ...items],
  [`${tab}Loading`]: false,
  pagination: { ...s.pagination, [tab]: { nextPage: meta?.nextPage || null, hasMore: !!meta?.nextPage } },
})),

setTabLoading: (tab, loading) => set({ [`${tab}Loading`]: loading }),
setTabError: (tab, error) => set({ [`${tab}Error`]: error, [`${tab}Loading`]: false }),

toggleFollowChannel: (channelId) => set(s => {
  const followed = s.followedChannels.includes(channelId)
  return {
    followedChannels: followed
      ? s.followedChannels.filter(id => id !== channelId)
      : [...s.followedChannels, channelId]
  }
}),
```

Add `followedChannels` to the `partialize` function for persistence. Bump version to 2 with a migration function that preserves existing saved/queue/playlist data.

- [ ] **Step 2: Commit**

```bash
git add apps/research/src/store/useMediaStore.js
git commit -m "feat(media): rewrite useMediaStore with API-driven per-tab state + channels"
```

---

## Task 6: Shared UI Components

**Files:**
- Create: `apps/research/src/pages/media-center/components/live-badge.jsx`
- Create: `apps/research/src/pages/media-center/components/media-tab-header.jsx`
- Create: `apps/research/src/pages/media-center/components/for-you-empty.jsx`

Small reusable components used across multiple tabs.

- [ ] **Step 1: Create `live-badge.jsx`**

Pulsing red dot + "LIVE" text. Uses `--bear` color. Reused on media cards and channel cards.

```jsx
import './live-badge.css'

const LiveBadge = ({ className = '' }) => (
  <span className={`mc-live-badge ${className}`.trim()}>
    <span className="mc-live-dot-sm" />
    LIVE
  </span>
)

export default LiveBadge
```

Create `live-badge.css` with the pulsing dot styles (extracted from `media-center-page.css` where `.mc-live-badge` and `.mc-live-dot-sm` already exist — move them to this standalone file so the component has no implicit dependency on the main page CSS).

- [ ] **Step 2: Create `media-tab-header.jsx`**

Tab title + "Last updated: Xh ago" + refresh button. Shows shimmer when loading.

```jsx
import spectreIcons from '@/icons/spectreIcons'

function timeAgoShort(isoDate) {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// NOTE: spectreIcons does not have a 'refresh' icon. Use an inline SVG:
const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
)

const MediaTabHeader = ({ title, lastRefreshed, loading, onRefresh, children }) => (
  <div className="mc-tab-header">
    <div className="mc-tab-header-left">
      <h2 className="mc-tab-title">{title}</h2>
      {children}
    </div>
    <div className="mc-tab-header-right">
      {lastRefreshed && (
        <span className="mc-tab-timestamp">{timeAgoShort(lastRefreshed)}</span>
      )}
      <button
        type="button"
        className={`mc-refresh-btn${loading ? ' spinning' : ''}`}
        onClick={onRefresh}
        disabled={loading}
        title="Refresh"
      >
        <RefreshIcon />
      </button>
    </div>
  </div>
)

export default MediaTabHeader
```

- [ ] **Step 3: Create `for-you-empty.jsx`**

Empty state CTA when user has no watchlist tokens.

```jsx
import spectreIcons from '@/icons/spectreIcons'
import { useNavigate } from 'react-router-dom'

const ForYouEmpty = () => {
  const navigate = useNavigate()
  return (
    <div className="mc-empty mc-for-you-empty">
      <span className="mc-empty-icon">{spectreIcons.star}</span>
      <h3 className="mc-empty-title">Personalize your feed</h3>
      <p className="mc-empty-desc">Add tokens to your watchlist and we'll surface relevant videos, streams, and podcasts.</p>
      <button type="button" className="mc-empty-cta" onClick={() => navigate('/watchlists')}>
        Go to Watchlists
      </button>
    </div>
  )
}

export default ForYouEmpty
```

- [ ] **Step 4: Commit**

```bash
git add apps/research/src/pages/media-center/components/live-badge.jsx apps/research/src/pages/media-center/components/live-badge.css apps/research/src/pages/media-center/components/media-tab-header.jsx apps/research/src/pages/media-center/components/for-you-empty.jsx
git commit -m "feat(media): add LiveBadge, MediaTabHeader, ForYouEmpty shared components"
```

---

## Task 7: Media Card Component

**Files:**
- Create: `apps/research/src/pages/media-center/components/media-card.jsx`
- Create: `apps/research/src/pages/media-center/components/media-card.css`

Universal card for Videos, Live, and Clips tabs. Renders the unified `MediaItem` model from the API. 16:9 thumbnail, duration badge (or live badge), title, channel avatar + name, view count, time ago, token tag pills, save/queue action overlay on hover.

- [ ] **Step 1: Create `media-card.jsx`**

Props: `item` (MediaItem), `isSaved`, `onPlay`, `onToggleSave`, `onAddToQueue`, `index`

Key logic:
- Thumbnail: `item.thumbnail` URL (from API, not hardcoded YouTube pattern)
- Duration: format seconds to `MM:SS` or `H:MM:SS`. If `item.type === 'live'`, show `<LiveBadge />` instead
- Channel: `item.channel.avatar` (24px circle) + `item.channel.name`
- Token tags: `item.tags.map(tag => <span className="mc-token-tag">{tag}</span>)`
- Source badge: small pill showing YouTube/Twitch icon
- Hover overlay: save + queue action buttons appear on `.mc-card-media:hover`

- [ ] **Step 2: Create `media-card.css`**

Glass card styling matching existing `.mc-card` but adapted for the unified model. Key additions:
- `.mc-token-tag` — small pill badge for token tags
- `.mc-source-badge` — YouTube/Twitch icon pill
- `.mc-channel-avatar` — 24px circle image
- Hover overlay for action buttons (save, queue)
- Entry animation: `mc-card-in` with staggered delay

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/media-center/components/media-card.jsx apps/research/src/pages/media-center/components/media-card.css
git commit -m "feat(media): add universal MediaCard component for videos/live/clips"
```

---

## Task 8: Shorts Card Component

**Files:**
- Create: `apps/research/src/pages/media-center/components/shorts-card.jsx`
- Create: `apps/research/src/pages/media-center/components/shorts-card.css`

Vertical 9:16 card for the Shorts tab. Title and view count overlay at bottom with gradient fade. More compact than media-card — grid shows more columns.

- [ ] **Step 1: Create `shorts-card.jsx`**

Props: `item` (MediaItem with type='short'), `onPlay`, `index`

Simpler than MediaCard: just thumbnail (9:16), title overlay at bottom, view count overlay, click to play.

- [ ] **Step 2: Create `shorts-card.css`**

- `.mc-shorts-card` — 9:16 aspect ratio via `aspect-ratio: 9/16`
- Title overlay at bottom with gradient fade from transparent to `rgba(0,0,0,0.8)`
- View count overlay (small, `--text-tertiary`)
- Grid uses `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` for compact layout
- Entry animation matching other cards

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/media-center/components/shorts-card.jsx apps/research/src/pages/media-center/components/shorts-card.css
git commit -m "feat(media): add ShortsCard component with vertical 9:16 layout"
```

---

## Task 9: Podcast Card Component

**Files:**
- Create: `apps/research/src/pages/media-center/components/podcast-card.jsx`
- Create: `apps/research/src/pages/media-center/components/podcast-card.css`

Episode card with thumbnail, title, podcast name, duration, and inline `<audio>` for Podcast Index items. YouTube-sourced podcasts click to open Theater Mode. Only one audio/video plays at a time.

- [ ] **Step 1: Create `podcast-card.jsx`**

Props: `item` (MediaItem with type='podcast'), `onPlay`, `isSaved`, `onToggleSave`, `index`

Logic branching:
- If `item.source === 'podcast-index'` and `item.audioUrl`: render inline `<audio>` element with native controls
- If `item.source === 'youtube'`: click opens Theater Mode (same as video cards)
- Audio `onPlay` event: pause any other playing audio/video via store

- [ ] **Step 2: Create `podcast-card.css`**

- `.mc-podcast-ep-card` — glass card with 16:9 thumbnail top
- Audio bar styling: compact controls, accent color for progress
- Podcast name + episode title + duration layout
- Staggered entry animation

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/media-center/components/podcast-card.jsx apps/research/src/pages/media-center/components/podcast-card.css
git commit -m "feat(media): add PodcastCard component with inline audio support"
```

---

## Task 10: Channel Card Component

**Files:**
- Create: `apps/research/src/pages/media-center/components/channel-card.jsx`
- Create: `apps/research/src/pages/media-center/components/channel-card.css`

Horizontal card for the Channels directory tab. Avatar, name, subscriber count, source badge, last upload timestamp, live indicator, follow/unfollow button.

- [ ] **Step 1: Create `channel-card.jsx`**

Props: `channel` (Channel model from API), `isFollowed`, `onToggleFollow`, `index`

Layout: horizontal — avatar (48px circle) left, info column right, follow button far right.
- Channel name (weight 600)
- Subscriber/follower count (mono font, abbreviated: 1.2M)
- Source badge pill: "YouTube" or "Twitch"
- "Last upload: 2d ago"
- If `channel.isLive`: `<LiveBadge />` next to name
- Follow button: ghost style, "Follow" / "Following" toggle

- [ ] **Step 2: Create `channel-card.css`**

- `.mc-channel-card` — horizontal glass card layout with flexbox
- `.mc-channel-avatar` — 48px circle with object-fit cover
- `.mc-channel-follow` — ghost button, filled when followed
- `.mc-channel-stats` — mono font for numbers
- `.mc-channel-source` — small pill badge
- Hover: translateY(-1px), border brightens

- [ ] **Step 3: Commit**

```bash
git add apps/research/src/pages/media-center/components/channel-card.jsx apps/research/src/pages/media-center/components/channel-card.css
git commit -m "feat(media): add ChannelCard component for channel directory"
```

---

## Task 11: Main Page Rewrite — 8 API-Driven Tabs

**Files:**
- Rewrite: `apps/research/src/pages/media-center/components/media-center-page.jsx`
- Update: `apps/research/src/pages/media-center/components/media-center-page.css`
- Delete: `apps/research/src/pages/media-center/components/media-center-data.js`

This is the largest task. The main page component gets rewritten to:
- 8 tabs: For You, Videos, Shorts, Live, Clips, Podcasts, Channels, Saved
- Each tab lazily fetches data on first click (not all on mount)
- Uses `mediaApi.js` service + `useMediaStore` for state
- Renders the new card components per tab
- Preserves search, queue button, theater/mini-player/drawer overlays
- Shimmer skeleton loaders while loading (no spinners)

- [ ] **Step 1: Define the 8 tabs constant**

```js
const TABS = [
  { id: 'forYou', label: 'For You' },
  { id: 'videos', label: 'Videos' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'live', label: 'Live' },
  { id: 'clips', label: 'Clips' },
  { id: 'podcasts', label: 'Podcasts' },
  { id: 'channels', label: 'Channels' },
  { id: 'saved', label: 'Saved' },
]
```

- [ ] **Step 2: Implement lazy tab fetching**

Each tab fetches on first activation. Use a `useEffect` keyed on `activeTab`:

```js
useEffect(() => {
  const items = store[`${activeTab}Items`]
  const loading = store[`${activeTab}Loading`]
  if (items.length > 0 || loading) return // already loaded or loading

  fetchTab(activeTab)
}, [activeTab])
```

`fetchTab(tab)` function dispatches to the correct `mediaApi` function:

```js
async function fetchTab(tab, refresh = false) {
  store.setTabLoading(tab, true)
  try {
    let result
    // Each mediaApi function accepts an optional last param for extra query params
    // When refresh=true, pass { refresh: true } to bypass server cache
    const opts = refresh ? { refresh: true } : {}
    switch (tab) {
      case 'forYou': result = await mediaApi.getForYou(watchlistTokens, opts); break
      case 'videos': result = await mediaApi.getVideos('crypto', null, opts); break
      case 'shorts': result = await mediaApi.getShorts('crypto', null, opts); break
      case 'live': result = await mediaApi.getLive(opts); break
      case 'clips': result = await mediaApi.getClips('week', opts); break
      case 'podcasts': result = await mediaApi.getPodcasts('crypto', opts); break
      case 'channels': result = await mediaApi.getChannels('all', opts); break
      default: return
    }
    store.setTabData(tab, result)
  } catch (err) {
    store.setTabError(tab, err.message)
  }
}
```

Update `mediaApi.js` functions to accept an optional `opts` parameter and merge `opts.refresh` into query params:

```js
export function getVideos(query = 'crypto', page, opts = {}) {
  return mediaFetch('/youtube/videos', { q: query, page, ...opts })
}
// Same pattern for all other functions
```
```

- [ ] **Step 3: Implement each tab's render section**

Each tab renders:
- `<MediaTabHeader>` with title, lastRefreshed, loading state, onRefresh callback
- Loading state: shimmer skeleton grid matching target card type
- Error state: error message with retry button
- Empty state: appropriate message
- Data state: grid of the appropriate card component

For You tab also checks watchlist context and shows `<ForYouEmpty />` if no tokens.

Videos/Shorts/Clips/Podcasts tabs include infinite scroll via `IntersectionObserver` on a sentinel div at the bottom.

Live tab includes auto-refresh via `setInterval` (10 min) while the tab is active. The interval clears when the user switches away from the Live tab. On the server side, the cache TTL is 5 min for YouTube live and 2 min for Twitch live, but the global rate limit (one external API call per 10 min regardless of user count) is enforced server-side — so the frontend's 10 min interval aligns with the server's global rate limit.

Channels tab renders `<ChannelCard>` with follow state from store.

Saved tab preserved from current implementation (local data).

- [ ] **Step 4: Add skeleton loaders to CSS**

Add shimmer skeleton classes per card type to `media-center-page.css`:
- `.mc-skeleton-card` — 16:9 placeholder + text lines
- `.mc-skeleton-short` — 9:16 tall placeholder
- `.mc-skeleton-podcast` — 16:9 + text + audio bar
- `.mc-skeleton-channel` — circle + text lines + button
- All use `.animate-shimmer` from the global design system

- [ ] **Step 5: Delete `media-center-data.js`**

Remove the static data file — all content now comes from the API.

- [ ] **Step 6: Commit**

```bash
git add apps/research/src/pages/media-center/components/media-center-page.jsx apps/research/src/pages/media-center/components/media-center-page.css
git rm apps/research/src/pages/media-center/components/media-center-data.js
git commit -m "feat(media): rewrite main page with 8 API-driven tabs + skeleton loaders"
```

---

## Task 12: Theater Mode + Mini Player — Multi-Source Support

**Files:**
- Modify: `apps/research/src/pages/media-center/components/theater-mode.jsx`
- Modify: `apps/research/src/pages/media-center/components/mini-player.jsx`

Update Theater Mode and Mini Player to handle YouTube, Twitch, and Podcast Index sources. Currently hardcoded to YouTube embeds.

- [ ] **Step 1: Update Theater Mode embed branching**

Replace the single YouTube iframe with source-based branching:

```jsx
function renderPlayer(item) {
  switch (item.source) {
    case 'youtube':
      return (
        <iframe
          src={`https://www.youtube.com/embed/${item.id.replace('yt_', '')}?autoplay=1&rel=0&enablejsapi=1`}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          className="mc-theater-iframe"
        />
      )
    case 'twitch':
      return (
        <iframe
          src={item.url}
          title={item.title}
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          className="mc-theater-iframe"
        />
      )
    case 'podcast-index':
      return (
        <div className="mc-theater-audio">
          <img src={item.thumbnail} alt="" className="mc-theater-audio-art" />
          <audio
            src={item.audioUrl}
            controls
            autoPlay
            onEnded={playNext}
            className="mc-theater-audio-player"
          />
        </div>
      )
    default:
      // Fallback: try YouTube embed pattern (backward compat with old saved items)
      return (
        <iframe
          src={`https://www.youtube.com/embed/${item.id}?autoplay=1&rel=0&enablejsapi=1`}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="mc-theater-iframe"
        />
      )
  }
}
```

Also update the thumbnail in queue sidebar to use `item.thumbnail` instead of hardcoded YouTube URL pattern.

- [ ] **Step 2: Update Mini Player**

Same source branching for the mini player embed. Podcast audio gets a compact bar with play/pause + scrubber + album art (48px).

- [ ] **Step 3: Add audio styles to theater-mode.css**

```css
.mc-theater-audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--sp-6);
}
.mc-theater-audio-art {
  width: 280px;
  height: 280px;
  border-radius: var(--radius-lg);
  object-fit: cover;
  box-shadow: var(--shadow-xl);
}
.mc-theater-audio-player {
  width: 100%;
  max-width: 500px;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/research/src/pages/media-center/components/theater-mode.jsx apps/research/src/pages/media-center/components/theater-mode.css apps/research/src/pages/media-center/components/mini-player.jsx apps/research/src/pages/media-center/components/mini-player.css
git commit -m "feat(media): update Theater Mode + Mini Player for YouTube/Twitch/podcast sources"
```

---

## Task 13: Environment Variables + Vite Proxy

**Files:**
- Modify: `.env` (add new API keys)
- Modify: `apps/research/vite.config.js` (verify `/api/media` proxy)

- [ ] **Step 1: Add placeholder env vars to `.env`**

```env
# Media Center APIs
YOUTUBE_API_KEY=
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
PODCAST_INDEX_KEY=
PODCAST_INDEX_SECRET=
```

- [ ] **Step 2: Verify Vite proxy covers `/api/media`**

The existing proxy config forwards all `/api` requests to the Express server. Verify that `/api/media/*` routes will be proxied correctly. The existing config likely already handles this since it proxies all `/api` paths — just confirm in `vite.config.js`.

- [ ] **Step 3: Commit**

```bash
git add .env
git commit -m "feat(media): add placeholder env vars for YouTube, Twitch, Podcast Index APIs"
```

---

## Task 14: Build Verification + Integration Test

**Files:** None new — verification only.

- [ ] **Step 1: Run research app build**

```bash
npm run build:research
```

Verify no import errors, no missing modules, clean build.

- [ ] **Step 2: Run server locally and test routes**

```bash
npm run dev:server &
sleep 2

# Test channels endpoint (works without API keys — returns seed data structure)
curl -s http://localhost:3001/api/media/channels | jq '.meta'

# Test YouTube endpoint (graceful error if no key)
curl -s http://localhost:3001/api/media/youtube/videos?q=bitcoin | jq '.meta'
```

- [ ] **Step 3: Start research app dev server and verify page loads**

```bash
npm run dev:research
```

Open `http://localhost:5180/ai-media-center`:
- Verify 8 tabs render
- Videos tab shows loading shimmer → content (or error if no API keys)
- Channels tab loads curated channels
- Saved tab works with existing localStorage data
- Theater Mode opens on video click
- Queue drawer works

- [ ] **Step 4: Commit any fixes from verification**

```bash
# Stage only the specific files that were fixed — review git status first
git status
git add <specific-files-that-changed>
git commit -m "fix(media): address build/integration issues from verification"
```
