/**
 * Vercel Serverless – Tweet proxy for Trading app
 * GET /api/tweets/official?username=HANDLE
 * Proxies to external backend and caches for 5 minutes.
 *
 * X-feed archive (2026-07-17): the upstream scraper serves ONLY the newest
 * ~31 timeline entries per handle (count/limit/cursor params are ignored -
 * probed), so an active account's history reaches back mere days
 * (@GoNeuralAI: 11.8d). Every successful fetch merges into a KV archive per
 * handle, so coverage COMPOUNDS across fetches instead of being a rolling
 * window. Dev twin: packages/server/index.js /api/tweets/official (keep the
 * merge semantics in sync).
 */

import { isAuthGateValid, isDemoSession } from './auth-gate.js';
import { getJsonWithTTL, setJsonWithTTL } from './_lib/kv.js';

const TWEETS_API_BASE = 'https://backend-277369611639.us-central1.run.app';

// In-memory cache (persists across warm invocations)
const tweetsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const XFEED_CAP = 400;
const XFEED_TTL_SEC = 90 * 24 * 3600;
const xfeedKey = (handle) => `xfeed:v1:${String(handle).toLowerCase()}`;
// Slim for storage: media blobs are the bulk of each tweet and nothing
// downstream reads them from the archive.
const xfeedSlim = (t) => ({
  tweet_id: t.tweet_id, username: t.username, tweet_text: t.tweet_text,
  created_at: t.created_at, date: t.date, followers: t.followers,
  like_count: t.like_count ?? t.likes, retweets: t.retweets, views: t.views,
  profile_image: t.profile_image,
});
const xfeedMerge = (fresh, archived) => {
  const seen = new Map();
  for (const t of [...(fresh || []), ...(archived || [])]) {
    const id = t?.tweet_id || (t?.username && t?.created_at ? `${t.username}:${t.created_at}` : null);
    if (id && !seen.has(id)) seen.set(id, t);
  }
  return [...seen.values()]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, XFEED_CAP);
};

// `?author_only=1` projection. The avatar/verified-badge resolvers read the
// ~1KB author object and discard the ~40KB timeline shipped with it. Measured
// on a token-page load (prod, 2026-08-04): 19 handles x 40KB = ~760KB pulled to
// render avatars and check marks, at ~1.5s per call. Slim responses also skip
// the KV archive merge (two round-trips) - they carry no tweets to archive, and
// the full-body path keeps doing the merge so history still compounds.
// Keep in sync with the dev twin: packages/server/index.js /api/tweets/official
const authorSlimCache = new Map(); // handle -> { data, timestamp }
const AUTHOR_CACHE_TTL = 10 * 60 * 1000; // profiles move far slower than feeds
const slimAuthor = (data) => ({ author: data?.author || null, _authorOnly: true });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 2026-05-11 lockdown: X-Dash quota.
  if (!isAuthGateValid(req) && !isDemoSession(req)) {
    return res.status(401).json({ error: 'Auth required', code: 'GATE_REQUIRED' });
  }

  const username = (req.query.username || '').trim();
  try {
    if (!username) {
      return res.status(400).json({ error: 'username query parameter is required' });
    }

    // Sanitize — only allow alphanumeric + underscores (Twitter handle rules)
    if (!/^[\w]{1,30}$/.test(username)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }

    const authorOnly = req.query.author_only === '1' || req.query.author_only === 'true';
    const handleKey = username.toLowerCase();

    // Check cache
    const cacheKey = `tweets:${handleKey}`;
    const cached = tweetsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
      return res.json(authorOnly ? slimAuthor(cached.data) : cached.data);
    }
    if (authorOnly) {
      const slim = authorSlimCache.get(handleKey);
      if (slim && Date.now() - slim.timestamp < AUTHOR_CACHE_TTL) {
        res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
        res.setHeader('CDN-Cache-Control', 'public, s-maxage=600');
        return res.json(slim.data);
      }
    }

    const url = `${TWEETS_API_BASE}/get_official_tweets?username=${encodeURIComponent(username)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      throw new Error(`Tweets API returned ${response.status}`);
    }

    let data = await response.json();

    // Slim path: answer with the author and stop. No archive merge (nothing to
    // archive) and no write into `tweetsCache` - that entry must only ever hold
    // a MERGED body, or a later full request would silently lose its history.
    if (authorOnly) {
      const slim = slimAuthor(data);
      authorSlimCache.set(handleKey, { data: slim, timestamp: Date.now() });
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=600');
      return res.json(slim);
    }

    // Merge with the KV archive so history compounds beyond the scraper's
    // ~31-post page. Await the write: serverless may kill post-response work.
    if (data && Array.isArray(data.tweets)) {
      try {
        const arch = await getJsonWithTTL(xfeedKey(username));
        const merged = xfeedMerge(data.tweets, arch?.tweets);
        data = { ...data, tweets: merged };
        await setJsonWithTTL(xfeedKey(username), { tweets: merged.map(xfeedSlim), updatedAt: Date.now() }, XFEED_TTL_SEC);
      } catch (e) {
        console.warn('[tweets] archive merge failed:', e.message);
      }
    }

    // Cache the result
    tweetsCache.set(cacheKey, { data, timestamp: Date.now() });

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=60');
    res.json(data);
  } catch (err) {
    console.error('Tweets API proxy error:', err.message);

    // `authorOnly` is scoped to the try block - re-read it here.
    const wantsAuthorOnly = req.query.author_only === '1' || req.query.author_only === 'true';

    // Return stale cache on error
    const cacheKey = `tweets:${username.toLowerCase()}`;
    const stale = tweetsCache.get(cacheKey);
    if (stale) {
      return res.json(wantsAuthorOnly ? slimAuthor(stale.data) : stale.data);
    }

    // author_only callers want a profile, not a feed - the archive carries no
    // author, so serving it would just be a slower way to return null.
    if (wantsAuthorOnly) {
      const slim = authorSlimCache.get(username.toLowerCase());
      if (slim) return res.json(slim.data);
      return res.json({ author: null, _authorOnly: true });
    }

    // Scraper down: the archive is still a real feed - serve it (marked) so
    // the agent's event study degrades to "older posts only" not "no data".
    try {
      const arch = await getJsonWithTTL(xfeedKey(username));
      if (arch && Array.isArray(arch.tweets) && arch.tweets.length) {
        return res.json({ author: null, tweets: arch.tweets, _archived: true });
      }
    } catch { /* fall through to 502 */ }

    res.status(502).json({ error: 'Failed to fetch tweets', message: err.message });
  }
}
