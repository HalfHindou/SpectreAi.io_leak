# AI Media Center — Dynamic API Integration

**Date:** 2026-03-19
**Status:** Draft
**Scope:** Replace static/curated media center content with live API-fed content from YouTube, Twitch, and Podcast Index.

---

## 1. Overview

The existing AI Media Center (`/ai-media-center`) has 35+ hardcoded YouTube videos, 6 Twitch channels, and 6 podcast links in `media-center-data.js`. This redesign replaces all static data with dynamic API-driven content.

### Goals
- All content fetched from real APIs — no hardcoded data
- 7 tabs: For You, Videos, Shorts, Live, Clips, Podcasts, Saved
- Personalized "For You" tab based on user's watchlist tokens
- User-triggered refresh with server-side caching to manage API quotas
- Existing playback features (Theater Mode, Mini Player, Queue) preserved

### Non-Goals
- Monetization or ad integration
- User-uploaded content
- Social features (comments, likes synced back to YouTube/Twitch)

---

## 2. External APIs

### YouTube Data API v3
- **Auth:** `YOUTUBE_API_KEY` in `.env` (server-side only)
- **Endpoints used:**
  - `search` — crypto keyword searches, filtered by type (video, short, live)
  - `videos` — video details, statistics, duration (for enrichment)
  - `channels` — channel metadata
- **Shorts detection:** Heuristic combining: (1) `#shorts` or `#short` in title/tags, (2) duration under 180s, (3) vertical thumbnail aspect ratio when available. Search queries append `#shorts` for dedicated Shorts tab.
- **Live detection:** `liveBroadcastContent === 'live'` from search results
- **Quota:** 10,000 units/day; each `search` = 100 units, `videos.list` = 1 unit

### Twitch Helix API
- **Auth:** `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` in `.env`
- **Auth flow:** Client credentials OAuth (app token, auto-refreshed server-side)
- **Endpoints used:**
  - `GET /streams` — currently live in crypto/trading categories
  - `GET /clips` — popular clips from crypto channels
  - `GET /videos` — VODs from crypto channels
- **Rate limit:** 800 requests/minute (generous)

### Podcast Index API
- **Auth:** `PODCAST_INDEX_KEY` + `PODCAST_INDEX_SECRET` in `.env`
- **Auth flow:** HMAC signature in headers (API key + secret + timestamp)
- **Endpoints used:**
  - `GET /search/byterm` — find crypto podcasts by keyword
  - `GET /episodes/byfeedid` — recent episodes from specific feeds
- **Rate limit:** Generous, no strict daily quota

---

## 3. Unified Media Item Model

All API responses are normalized into this shape before reaching the frontend:

```js
{
  id: string,           // source-prefixed: "yt_abc123", "tw_456", "pod_789"
  type: 'video' | 'short' | 'live' | 'clip' | 'podcast',
  source: 'youtube' | 'twitch' | 'podcast-index',
  title: string,
  thumbnail: string,    // URL to thumbnail image
  channel: {
    name: string,
    avatar: string,     // URL to channel avatar
    url: string,        // link to channel page
  },
  duration: number,     // seconds (0 for live streams)
  publishedAt: string,  // ISO 8601 date
  viewCount: number,
  url: string,          // embed URL for playback
  tags: string[],       // extracted crypto tokens: ['BTC', 'ETH', 'SOL']
}
```

### Tag Extraction
Token tags are extracted by matching video title and description against known symbols from `majorTokens.js`. This powers the "For You" tab personalization.

---

## 4. Server Routes

### New Express Route File: `packages/server/routes/media.js`

```
GET /api/media/youtube/videos?q=crypto&page=1     → YouTube video search
GET /api/media/youtube/shorts?q=crypto&page=1     → YouTube shorts search
GET /api/media/youtube/live                        → YouTube live crypto streams
GET /api/media/twitch/live                         → Twitch live crypto streams
GET /api/media/twitch/clips?period=week            → Twitch popular clips
GET /api/media/podcasts/search?q=crypto            → Podcast Index search
GET /api/media/podcasts/episodes?feedId=123        → Podcast episodes by feed
GET /api/media/feed/for-you?tokens=BTC,ETH,SOL    → Personalized mix (merges sources)
```

### Twitch OAuth Token Management
- Server maintains an in-memory app access token
- Auto-refreshes when expired (client credentials grant)
- No user-level Twitch auth needed

### Podcast Index Auth
- Each request includes headers: `X-Auth-Key`, `X-Auth-Date`, `Authorization` (SHA-1 HMAC of key + secret + epoch)

### Response Shape
All routes return:
```js
{
  items: MediaItem[],
  meta: {
    source: string,
    cached: boolean,
    lastRefreshed: string,  // ISO timestamp
    nextPage: string | null,
  }
}
```

---

## 5. Caching Strategy

### Server-Side In-Memory Cache
- Cache key = route path + query params hash
- Each cache entry stores: `{ data, timestamp, ttl }`
- On request: if cache exists and not expired, return cached data
- If cache expired: return stale data with `meta.cached: true` flag; user can trigger refresh

### TTLs by Content Type

| Source | TTL | Refresh |
|--------|-----|---------|
| YouTube videos | 4 hours | User-triggered |
| YouTube shorts | 4 hours | User-triggered |
| YouTube live | 5 minutes | Auto when Live tab active |
| Twitch live | 2 minutes | Auto when Live tab active |
| Twitch clips | 4 hours | User-triggered |
| Podcasts search | 6 hours | User-triggered |
| Podcast episodes | 6 hours | User-triggered |
| For You feed | 4 hours | User-triggered |

### Live Tab Special Handling
- Auto-refreshes only when user is actively on the Live tab
- Global rate limit: 1 API call per 5 minutes regardless of user count
- When user leaves Live tab, auto-refresh stops

### YouTube Quota Budget (10,000 units/day)

| Scenario | Cost | Units |
|----------|------|-------|
| Cold start (first visit, all YouTube tabs empty) | 3 searches (Videos + Shorts + Live) + 3 videos.list enrichments | ~303 |
| Per-tab refresh (user-triggered) | 1 search + 1 videos.list | ~101 |
| For You refresh (2 token searches) | 2 searches + 2 videos.list | ~202 |
| Live auto-refresh (5min interval, active viewing) | 1 search per 5 min, global | ~100/call |

**Daily budget allocation:**
- Live auto-refresh (worst case 8h active): 96 calls = **9,600 units** — too high
- **Mitigation:** Live tab uses `search` with `eventType=live` only once per 10 min globally (not per-user) = 48 calls = 4,800 units
- Remaining for user refreshes: ~5,200 units = ~51 tab refreshes/day
- **Lazy tab loading:** Tabs only fetch when first clicked, not on page mount. Cold start cost = 1 search (default tab only)

### For You Cache Strategy
The `/api/media/feed/for-you?tokens=BTC,ETH,SOL` endpoint caches per-token results individually server-side. The feed is composed by merging per-token caches. This way `?tokens=BTC,ETH` and `?tokens=BTC,SOL` share the BTC cache entry. Tokens are sorted alphabetically in cache keys for consistency.

---

## 6. Vercel Serverless Function (Production)

### New file: `apps/research/api/media.js`

Single serverless function that routes based on query parameters. Pattern matches existing `cg-proxy.js`.

```
/api/media?source=youtube&type=videos&q=crypto
/api/media?source=twitch&type=live
/api/media?source=podcasts&type=search&q=crypto
/api/media?source=feed&type=for-you&tokens=BTC,ETH
```

Internally calls the same API logic as Express routes. Caching in serverless uses a simple module-level Map (survives within warm function instances, not guaranteed across cold starts).

### Vercel Rewrite Rules

Add to `vercel.json` rewrites array:
```json
{ "source": "/api/media/youtube/:type", "destination": "/api/media?source=youtube&type=:type" },
{ "source": "/api/media/twitch/:type", "destination": "/api/media?source=twitch&type=:type" },
{ "source": "/api/media/podcasts/:type", "destination": "/api/media?source=podcasts&type=:type" },
{ "source": "/api/media/feed/:type", "destination": "/api/media?source=feed&type=:type" }
```

This maps the Express-style paths the frontend uses to the single serverless function's query-param routing.

---

## 7. Playback Architecture

Theater Mode and Mini Player must support all three sources. Embed URL construction per source:

### Embed URL Patterns
| Source | Embed URL | Thumbnail URL |
|--------|-----------|---------------|
| YouTube video/short | `https://www.youtube.com/embed/{videoId}?autoplay=1&rel=0&enablejsapi=1` | `https://img.youtube.com/vi/{videoId}/mqdefault.jpg` |
| Twitch live | `https://player.twitch.tv/?channel={channelName}&parent={hostname}` | From Twitch API `thumbnail_url` field |
| Twitch clip | `https://clips.twitch.tv/embed?clip={clipId}&parent={hostname}` | From Twitch API `thumbnail_url` field |
| Podcast (YouTube) | Same as YouTube video | Same as YouTube video |
| Podcast (Podcast Index) | Audio-only — no iframe embed | From Podcast Index `image` field |

### Theater Mode Branching
```js
switch (activeItem.source) {
  case 'youtube':
    // Existing YouTube iframe with postMessage onStateChange for auto-play-next
    break;
  case 'twitch':
    // Twitch embed iframe — no postMessage API for auto-play-next
    // Auto-play-next disabled for live streams, enabled for clips (on clip end via timeout = duration)
    break;
  case 'podcast-index':
    // HTML <audio> element with full controls, album art background
    // onended event triggers auto-play-next
    break;
}
```

### Mini Player Branching
- YouTube/Twitch: iframe embed (existing pattern)
- Podcast Index audio: compact audio bar with play/pause, scrubber, podcast art (48x48)

### Simultaneous Playback Prevention
Only one media item plays at a time. Starting any playback pauses/stops any other active player (YouTube, Twitch, or audio).

---

## 8. Frontend Tabs & Service Layer

### 7 Tabs

| Tab | Source | Content |
|-----|--------|---------|
| **For You** | YouTube + Twitch + Podcasts | Filtered by user's watchlist tokens |
| **Videos** | YouTube | Standard crypto videos, sorted by recency |
| **Shorts** | YouTube | Vertical short-form (<60s) |
| **Live** | YouTube + Twitch | Currently broadcasting |
| **Clips** | Twitch | Popular highlights from crypto streamers |
| **Podcasts** | YouTube (long-form) + Podcast Index | Audio/video podcasts |
| **Saved** | Local (Zustand persist) | User's bookmarked items |

### Frontend Service: `src/services/mediaApi.js`

Single service file with functions per endpoint:
- `getVideos(query, page)` → `/api/media/youtube/videos`
- `getShorts(query, page)` → `/api/media/youtube/shorts`
- `getLive()` → merges `/api/media/youtube/live` + `/api/media/twitch/live`
- `getClips(period)` → `/api/media/twitch/clips`
- `getPodcasts(query)` → `/api/media/podcasts/search`
- `getPodcastEpisodes(feedId)` → `/api/media/podcasts/episodes`
- `getForYou(tokens)` → `/api/media/feed/for-you`

All functions return `{ items: MediaItem[], meta }`. Adding `?refresh=true` query param bypasses server cache.

### Zustand Store: `useMediaStore.js` (rewrite)

```js
{
  // API-driven state (per tab)
  items: { forYou: [], videos: [], shorts: [], live: [], clips: [], podcasts: [] },
  loading: { forYou: false, videos: false, ... },
  lastRefreshed: { forYou: null, videos: null, ... },
  error: { forYou: null, videos: null, ... },

  // Pagination state (per tab)
  pagination: {
    videos: { nextPage: null, hasMore: true },
    shorts: { nextPage: null, hasMore: true },
    clips: { nextPage: null, hasMore: true },
    podcasts: { nextPage: null, hasMore: true },
  },

  // User state (persisted to localStorage)
  savedItems: [],
  recentlyWatched: [],
  queue: [],
  playlists: [],

  // Playback state
  activeVideo: null,
  theaterOpen: false,
  miniPlayerOpen: false,
  queueDrawerOpen: false,

  // Actions — store manages state, components call mediaApi service then update store
  setTabData(tab, { items, meta }),   // called after mediaApi response
  appendTabPage(tab, { items, meta }), // for infinite scroll (appends to existing)
  setLoading(tab, bool),
  setError(tab, error),
  saveItem(item),
  unsaveItem(id),
  addToQueue(item),
  // ... existing playback actions preserved
}
```

### Data Flow (store/service separation)
Components call `mediaApi.getVideos()` → receive data → call `store.setTabData('videos', data)`. The store does NOT call APIs directly. This matches the existing pattern where `coinGeckoApi.js` is called from components/hooks, not from Zustand stores.

### Pagination
Videos, Shorts, Clips, and Podcasts tabs support infinite scroll. The `meta.nextPage` cursor from the server response is stored in `pagination[tab].nextPage`. When the user scrolls near the bottom, the component calls `mediaApi.getVideos(query, nextPage)` → `store.appendTabPage('videos', data)`. For You and Live tabs are not paginated (finite result sets).

---

## 9. Component Structure

### File Tree

```
apps/research/src/pages/media-center/
  index.jsx                          (existing — kept as-is)
  components/
    media-center-page.jsx            (rewrite — API-driven tabs)
    media-center-page.css            (update — new tab + card styles)
    media-card.jsx                   (new — universal card for videos/live/clips)
    media-card.css
    shorts-card.jsx                  (new — vertical 9:16 card)
    shorts-card.css
    podcast-card.jsx                 (new — episode card with audio player)
    podcast-card.css
    live-badge.jsx                   (new — pulsing red dot indicator)
    media-tab-header.jsx             (new — tab title + refresh button + timestamp)
    for-you-empty.jsx                (new — watchlist CTA empty state)
    media-center-data.js             (DELETE — replaced by API)

apps/research/src/services/
    mediaApi.js                      (new — all /api/media calls)

apps/research/src/store/
    useMediaStore.js                 (rewrite — API-driven state)

packages/server/routes/
    media.js                         (new — Express routes for all 3 APIs)

apps/research/api/
    media.js                         (new — Vercel serverless function)
```

### Card Variants

**media-card** (Videos, Live, Clips)
- 16:9 thumbnail with duration badge (bottom-right)
- Live items get red pulsing live-badge instead of duration
- Title (1-2 lines, truncated), channel name + avatar, view count, time ago
- Token tag pills at bottom: [BTC] [ETH]
- Hover: translateY(-2px), save/queue action icons appear as overlay
- Glass card base, Apple Cinematic styling

**shorts-card** (Shorts)
- 9:16 vertical aspect ratio
- No duration badge (all <60s)
- Title overlay at bottom of thumbnail (gradient fade)
- View count overlay
- Compact — grid shows more columns

**podcast-card** (Podcasts)
- 16:9 thumbnail (top)
- Episode title, podcast name, duration
- Podcast Index items: inline `<audio>` element using `enclosureUrl` (MP3/M4A — browser-native, no CORS issues since audio files are served with permissive headers from podcast CDNs)
- YouTube-sourced podcasts: click opens Theater Mode (no native audio)
- Only one audio/video plays at a time — starting a podcast pauses any active video and vice versa

**live-badge** (reusable component)
- Pulsing red dot (8px, `--bear` color) + "LIVE" text
- `box-shadow: 0 0 8px var(--bear-glow)` pulse animation
- Used as overlay on media-card and shorts-card thumbnails

**media-tab-header** (reusable per tab)
- Tab title (left) + "Last updated: 2h ago" + Refresh icon button (right)
- Refresh button triggers refresh; content area shows shimmer skeletons while loading (no spinners per design system)

**for-you-empty** (For You tab empty state)
- "Add tokens to your watchlist to personalize this feed"
- Link/button to watchlist page
- Glass card with subtle animation

### Skeleton Loaders (per card type)
All loading states use shimmer skeletons matching target card dimensions. No spinners.

| Card | Skeleton Shape |
|------|---------------|
| media-card | 16:9 rectangle (thumbnail) + 2 text lines + small circle (avatar) + short line |
| shorts-card | 9:16 tall rectangle + 1 text line overlay |
| podcast-card | 16:9 rectangle + 2 text lines + thin audio bar rectangle |

Staggered entry: `.stagger-1` through `.stagger-5` (50ms increments) on skeleton cards within each grid.

---

## 10. Environment Variables

New keys added to `.env` at monorepo root:

```env
# YouTube Data API v3
YOUTUBE_API_KEY=

# Twitch Helix API
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=

# Podcast Index API
PODCAST_INDEX_KEY=
PODCAST_INDEX_SECRET=
```

All server-side only. No `VITE_` prefix needed.

---

## 11. Existing Features Preserved

These features already work and will be kept as-is, just fed dynamic data instead of static:

- **Theater Mode** — full-screen immersive YouTube/Twitch player
- **Mini Player** — floating bottom-right corner embed
- **Queue** — ordered playlist of items to watch
- **Playlists** — user-created collections
- **Recently Watched** — auto-tracked viewing history
- **Save/Bookmark** — persisted in localStorage via Zustand
- **Search** — now searches current tab's API results (client-side filter of loaded items)
- **Keyboard navigation** — preserved in all card grids

---

## 12. Edge Cases

- **YouTube quota exhausted**: Return cached data with warning banner "Content may be outdated — daily refresh limit reached"
- **Twitch token expired**: Auto-refresh on 401, retry once, then return error
- **Podcast Index down**: Return empty with error message, other tabs unaffected
- **No watchlist tokens**: "For You" tab shows empty state with CTA
- **CORS**: All API calls go through server proxy — no direct browser-to-API calls
- **Binance-style IP blocking**: YouTube/Twitch/Podcast Index don't block Vercel IPs currently, but serverless function includes error handling for 403s
