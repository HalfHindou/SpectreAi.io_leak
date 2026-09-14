import { isDev } from '@/utils/env';

/**
 * Media Center API Service
 * All calls go through /api/media/* — Vite proxy in dev, Vercel functions in prod
 */

const MEDIA_API = '/api/media';
const TIMEOUT = 15000;

/* Sample comments so the player's live-comments panel is alive in dev. */
const DEV_COMMENTS = [
  { id: 'c1', author: 'degenspartan', avatarUrl: '', text: 'this thesis aged like fine wine. stablecoins are the real adoption vector', likeCount: 412, publishedAt: new Date(Date.now() - 36e5).toISOString() },
  { id: 'c2', author: 'CryptoMessiah', avatarUrl: '', text: 'the part about onchain FX settlement is criminally underrated', likeCount: 233, publishedAt: new Date(Date.now() - 72e5).toISOString() },
  { id: 'c3', author: 'sassal0x', avatarUrl: '', text: 'ETH L2s + stables is the endgame and nobody is pricing it in', likeCount: 188, publishedAt: new Date(Date.now() - 90e5).toISOString() },
  { id: 'c4', author: 'light', avatarUrl: '', text: 'great convo. the regulatory clarity point is the unlock', likeCount: 96, publishedAt: new Date(Date.now() - 12e6).toISOString() },
  { id: 'c5', author: 'punk6529', avatarUrl: '', text: 'open metaverse needs open money rails. this is it', likeCount: 74, publishedAt: new Date(Date.now() - 16e6).toISOString() },
  { id: 'c6', author: 'Ansem', avatarUrl: '', text: 'bullish. timestamps would be clutch though', likeCount: 51, publishedAt: new Date(Date.now() - 20e6).toISOString() },
  { id: 'c7', author: 'RyanSAdams', avatarUrl: '', text: 'we are still so early it is unreal', likeCount: 39, publishedAt: new Date(Date.now() - 26e6).toISOString() },
];

/* Sample Twitch crypto livestreams so the Live tab is alive in dev (creds are Vercel-only). */
const DEV_TWITCH_LIVE = [
  { id: 'tw_dev1', type: 'live', source: 'twitch', title: 'Live Trading Memecoins on Solana — $180k+ PNL', thumbnail: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_solanaswaggy-320x180.jpg', channel: { name: 'solanaswaggy', avatar: '', url: 'https://www.twitch.tv/solanaswaggy' }, duration: 0, publishedAt: new Date(Date.now() - 36e5).toISOString(), viewCount: 233, url: 'https://player.twitch.tv/?channel=solanaswaggy&parent=localhost&autoplay=true&muted=false', audioUrl: null, tags: ['SOL'] },
  { id: 'tw_dev2', type: 'live', source: 'twitch', title: '24/7 LIVE Futures Trading + Bitcoin', thumbnail: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_markettraderstv-320x180.jpg', channel: { name: 'MarketTradersTV', avatar: '', url: 'https://www.twitch.tv/markettraderstv' }, duration: 0, publishedAt: new Date(Date.now() - 72e5).toISOString(), viewCount: 64, url: 'https://player.twitch.tv/?channel=markettraderstv&parent=localhost&autoplay=true&muted=false', audioUrl: null, tags: ['BTC'] },
];

/* Sample Spotify latest-episode metadata so the podcast cards show duration/date in dev. */
const DEV_SPOTIFY_LATEST = {
  '1P6ZeYd9vbF3hJA2n7qoL5': { durationSec: 3612, releaseDate: '2026-06-16', episodeTitle: 'Alex Cutler: The Next Rotation' },
  '41TNnXSv5ExcQSzEGLlGhy': { durationSec: 5040, releaseDate: '2026-06-15', episodeTitle: 'The ETH Endgame' },
  '4UTePv1CR3APdKOiosR3Iq': { durationSec: 4230, releaseDate: '2026-06-16', episodeTitle: 'Why This Cycle Is Different' },
  '1cJrrfGY1SKBIRn5noKSAf': { durationSec: 3900, releaseDate: '2026-06-14', episodeTitle: 'Inside the SEC Shift' },
  '3uMWirMj2hc7IQYEUeBTyT': { durationSec: 4500, releaseDate: '2026-06-15', episodeTitle: 'The DeFi Supercycle' },
  '6JWaXUZF24H0joX1e30GYi': { durationSec: 3300, releaseDate: '2026-06-16', episodeTitle: 'Solana Is Eating Everything' },
  '1dYQYB5WxUqmypXXkFuac0': { durationSec: 2880, releaseDate: '2026-06-13', episodeTitle: 'DeFis Near Death Moment' },
  '18Pixm6jNMATYXSO6cUnTH': { durationSec: 4680, releaseDate: '2026-06-15', episodeTitle: 'The Bottom Is In' },
  '0bn8XQHWGxXULjhp1jRmOJ': { durationSec: 3000, releaseDate: '2026-06-16', episodeTitle: 'Bitcoin To 250k' },
  '0YOEwxAR1uIx1a15QpqE0l': { durationSec: 3540, releaseDate: '2026-06-14', episodeTitle: 'Saylor On The Quantum Debate' },
  '67Kt4UameBIU6KFUl8QJKj': { durationSec: 2700, releaseDate: '2026-06-15', episodeTitle: 'The Macro Read' },
};

/* In local dev the media keys live only in Vercel prod, so the real proxy
   returns nothing. We serve a curated SAMPLE dataset instead so the editorial
   UI is fully alive while developing. The sample module is dynamically imported
   so it is never bundled into the production path. */
async function devSample(path, params = {}) {
  const s = await import('@/pages/media-center/components/media-sample');
  const meta = { source: 'dev-sample', cached: false, lastRefreshed: new Date().toISOString() };
  if (path.startsWith('/feed/discover')) {
    return { featured: s.SAMPLE_DISCOVER.featured, sections: s.SAMPLE_DISCOVER.sections, meta };
  }
  if (path.startsWith('/podcasts/curated')) return { items: s.SAMPLE_PODCASTS, meta };
  if (path.startsWith('/podcasts/transcript')) return { ...s.SAMPLE_TRANSCRIPT, meta };
  if (path.startsWith('/podcasts/episodes')) return { items: s.SAMPLE_PODCASTS.slice(0, 12), meta };
  if (path.startsWith('/podcasts/show')) {
    return { feed: { id: 1, title: params.q || 'Show', author: '', image: '', description: '' }, items: s.SAMPLE_PODCASTS.slice(0, 10), meta };
  }
  if (path.startsWith('/youtube/shorts')) return { items: s.SAMPLE_SHORTS, meta, nextPage: null };
  if (path.startsWith('/youtube/videos')) return { items: s.SAMPLE_VIDEOS, meta, nextPage: null };
  if (path.startsWith('/youtube/live')) return { items: s.SAMPLE_LIVE, meta };
  if (path.startsWith('/twitch/live')) return { items: DEV_TWITCH_LIVE, meta };
  if (path.startsWith('/youtube/comments')) return { items: DEV_COMMENTS, meta };
  if (path.startsWith('/spotify/latest')) return { items: DEV_SPOTIFY_LATEST, meta };
  if (path.startsWith('/youtube/channel')) return { items: s.SAMPLE_VIDEOS.slice(0, 8), meta };
  if (path.startsWith('/channels')) return { items: s.SAMPLE_CHANNELS, meta };
  if (path.startsWith('/feed/for-you')) return { items: s.SAMPLE_VIDEOS.slice(0, 8), meta };
  return { items: [], meta };
}

async function mediaFetch(path, params = {}) {
  if (isDev) {
    try {
      return await devSample(path, params);
    } catch {
      return { items: [], meta: { source: 'dev-sample-error' } };
    }
  }

  const url = new URL(`${MEDIA_API}${path}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== undefined) url.searchParams.set(k, String(v));
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Media API error: ${res.status}`);
    return res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export function getVideos(query = 'crypto', page, opts = {}) {
  return mediaFetch('/youtube/videos', { q: query, page, ...opts });
}

export function getVideosPage(query = 'crypto', pageToken, opts = {}) {
  return mediaFetch('/youtube/videos', { q: query, page: pageToken, ...opts });
}

export function getShorts(query = 'crypto', page, opts = {}) {
  return mediaFetch('/youtube/shorts', { q: query, page, ...opts });
}

export function getShortsPage(query = 'crypto', pageToken, opts = {}) {
  return mediaFetch('/youtube/shorts', { q: query, page: pageToken, ...opts });
}

export function getLive(opts = {}) {
  return Promise.all([
    mediaFetch('/youtube/live', { ...opts }).catch(() => ({ items: [], meta: { source: 'youtube' } })),
    mediaFetch('/twitch/live', { ...opts }).catch(() => ({ items: [], meta: { source: 'twitch' } })),
  ]).then(([yt, tw]) => ({
    items: [...yt.items, ...tw.items].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)),
    meta: { source: 'mixed', cached: yt.meta?.cached || tw.meta?.cached, lastRefreshed: new Date().toISOString() },
  }));
}

export function getChannels(opts = {}) {
  return mediaFetch('/channels', { ...opts });
}

export function getChannelVideos(channelId, pageToken, opts = {}) {
  return mediaFetch(`/youtube/channel/${channelId}`, { pageToken, ...opts });
}

export function getForYou(tokens, opts = {}) {
  return mediaFetch('/feed/for-you', { tokens: Array.isArray(tokens) ? tokens.join(',') : tokens, ...opts });
}

/* Curated editorial home: { featured, sections } — Rollup-style. */
export function getDiscover(opts = {}) {
  return mediaFetch('/feed/discover', { ...opts });
}

/* Curated premium crypto podcasts (episodes, newest-first). */
export function getPodcasts(opts = {}) {
  return mediaFetch('/podcasts/curated', { ...opts });
}

/* Top comments for a video (for the player's live-comments panel). */
export function getComments(videoId, opts = {}) {
  if (!videoId) return Promise.resolve({ items: [] });
  return mediaFetch('/youtube/comments', { videoId, ...opts });
}

/* Latest-episode metadata (duration + date) per Spotify show, keyed by show id. */
export function getSpotifyLatest(opts = {}) {
  return mediaFetch('/spotify/latest', { ...opts });
}

/* Resolve a show BY NAME to its feed + recent episodes. The curated Spotify
   shows are keyed by Spotify id and their embed only exposes the latest
   episode, so this is the only way to offer a back catalogue for them. */
export function getShowByName(name, opts = {}) {
  if (!name) return Promise.resolve({ feed: null, items: [] });
  return mediaFetch('/podcasts/show', { q: name, ...opts })
    .catch(() => ({ feed: null, items: [] }));
}

/* Every recent episode of one show — the "more from this show" rail. */
export function getShowEpisodes(feedId, opts = {}) {
  if (!feedId) return Promise.resolve({ items: [] });
  return mediaFetch('/podcasts/episodes', { feedId, ...opts });
}

/* Real caption cues for an episode, parsed server-side from the show's own
   <podcast:transcript>. Returns { kind: 'timed'|'text'|'none', cues, paragraphs }.
   'none' is a legitimate answer — most shows publish no transcript, and the
   player says so instead of inventing captions. */
export function getTranscript(url, type, opts = {}) {
  if (!url) return Promise.resolve({ kind: 'none', cues: [], paragraphs: [] });
  return mediaFetch('/podcasts/transcript', { url, type, ...opts })
    .catch(() => ({ kind: 'none', cues: [], paragraphs: [], reason: 'fetch-error' }));
}

/* Dev fallback synthesis (when Express/GROQ isn't reachable locally). */
const DEV_SYNTH = {
  tldr: 'A fast, investor-grade read on the core thesis of this episode.',
  points: [
    'Key claim or topic #1 covered in the discussion',
    'A specific data point or market call made by the host',
    'The counter-argument or risk raised',
    'A concrete name, protocol, or catalyst mentioned',
  ],
  takeaway: 'Why this matters for positioning right now.',
};

/* AI synthesis (TL;DR + key points + takeaway) for a video or podcast.
   Hits the real endpoint in BOTH dev and prod (GROQ runs server-side); falls
   back to a sample only if the network/LLM is unreachable in dev. */
export async function getSynthesis({ kind = 'video', id, title = '', source = '' } = {}) {
  if (!id) return { summary: null };
  const url = new URL(`${MEDIA_API}/ai/synthesize`, window.location.origin);
  url.searchParams.set('kind', kind);
  url.searchParams.set('id', id);
  if (title) url.searchParams.set('title', title.slice(0, 200));
  if (source) url.searchParams.set('source', source.slice(0, 120));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`synthesize ${res.status}`);
    const json = await res.json();
    // In dev the discover feed is sample data (fake ids) so real synthesis can't
    // resolve a description — show the sample card so the UI is verifiable.
    if (isDev && !json?.summary) return { summary: { ...DEV_SYNTH, title }, meta: { source: 'dev-sample' } };
    return json;
  } catch (err) {
    clearTimeout(timeoutId);
    if (isDev) return { summary: { ...DEV_SYNTH, title }, meta: { source: 'dev-sample' } };
    return { summary: null, reason: 'fetch-error' };
  }
}
