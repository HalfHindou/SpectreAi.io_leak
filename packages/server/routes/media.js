/**
 * Spectre AI Media Center — API Routes
 *
 * Uses YouTube RSS feeds (free, no quota) from curated channels
 * for videos/shorts. YouTube Data API used only for optional enrichment
 * (channel details, video durations). Twitch for live streams.
 *
 * All routes normalize responses to MediaItem[] shape.
 * All routes support ?refresh=true to bypass cache.
 *
 * Mount: app.use('/api/media', mediaRoutes)
 */

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { chat: gatewayChat } = require('../lib/llm-gateway');

// ─── Constants ──────────────────────────────────────────────────────────────

const TTL = {
  YT_VIDEOS:        4 * 60 * 60 * 1000,  // 4 hours
  YT_SHORTS:        4 * 60 * 60 * 1000,  // 4 hours
  YT_LIVE:          5 * 60 * 1000,        // 5 minutes
  LIVE_PREMIUM:     3 * 60 * 1000,        // 3 minutes (premium-channel live)
  COMMENTS:        10 * 60 * 1000,        // 10 minutes (video comments)
  TW_LIVE:          2 * 60 * 1000,        // 2 minutes
  CHANNELS:        12 * 60 * 60 * 1000,  // 12 hours
  FOR_YOU:          4 * 60 * 60 * 1000,  // 4 hours
  RSS_FEED:         2 * 60 * 60 * 1000,  // 2 hours per channel RSS
  PODCAST:          6 * 60 * 60 * 1000,  // 6 hours
  SPOTIFY:          6 * 60 * 60 * 1000,  // 6 hours (latest-episode metadata)
  DISCOVER:         2 * 60 * 60 * 1000,  // 2 hours
  SYNTH:           14 * 24 * 60 * 60 * 1000, // 14 days (AI synthesis — static content)
};

// Curated Spotify show IDs — latest-episode duration + release date enrich
// podcast cards. DEGRADES GRACEFULLY: no creds → empty items, never throws.
const SPOTIFY_SHOW_IDS = [
  '1P6ZeYd9vbF3hJA2n7qoL5','41TNnXSv5ExcQSzEGLlGhy','4UTePv1CR3APdKOiosR3Iq',
  '1cJrrfGY1SKBIRn5noKSAf','3uMWirMj2hc7IQYEUeBTyT','6JWaXUZF24H0joX1e30GYi',
  '1dYQYB5WxUqmypXXkFuac0','18Pixm6jNMATYXSO6cUnTH','0bn8XQHWGxXULjhp1jRmOJ',
  '0YOEwxAR1uIx1a15QpqE0l','67Kt4UameBIU6KFUl8QJKj',
];

// Latest-episode metadata via Apple's free, keyless iTunes Lookup API (no
// SPOTIFY_CLIENT_* env needed). Spotify show id -> Apple Podcasts collection id.
const APPLE_PODCASTS = [
  { spotifyId: '1P6ZeYd9vbF3hJA2n7qoL5', appleId: '1523220564' }, // The Rollup
  { spotifyId: '41TNnXSv5ExcQSzEGLlGhy', appleId: '1499409058' }, // Bankless
  { spotifyId: '4UTePv1CR3APdKOiosR3Iq', appleId: '1554930038' }, // Empire
  { spotifyId: '1cJrrfGY1SKBIRn5noKSAf', appleId: '1123922160' }, // Unchained
  { spotifyId: '3uMWirMj2hc7IQYEUeBTyT', appleId: '1641356619' }, // Bell Curve
  { spotifyId: '6JWaXUZF24H0joX1e30GYi', appleId: '1697548240' }, // Lightspeed
  { spotifyId: '1dYQYB5WxUqmypXXkFuac0', appleId: '1512654905' }, // The Defiant
  { spotifyId: '18Pixm6jNMATYXSO6cUnTH', appleId: '1482455669' }, // What Bitcoin Did
  { spotifyId: '0bn8XQHWGxXULjhp1jRmOJ', appleId: '1434060078' }, // The Pomp Podcast
  { spotifyId: '0YOEwxAR1uIx1a15QpqE0l', appleId: '1569130932' }, // Coin Stories
  { spotifyId: '67Kt4UameBIU6KFUl8QJKj', appleId: '1347049808' }, // Unconfirmed
];

async function fetchAppleLatest(appleId) {
  const url = `https://itunes.apple.com/lookup?id=${appleId}&media=podcast&entity=podcastEpisode&limit=3`;
  const apiRes = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!apiRes.ok) return null;
  const data = await apiRes.json();
  const ep = (data.results || []).find(r => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode');
  if (!ep) return null;
  return {
    durationSec: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : 0,
    releaseDate: ep.releaseDate || '',
    episodeTitle: ep.trackName || '',
  };
}

// Curated PREMIUM crypto channels (highest-signal). Channel ids are pinned here
// (the JSON seed is an incomplete subset) so feed/discover is reliable + mirrors
// the serverless handler's PREMIUM_CHANNELS exactly.
const PREMIUM_CHANNELS = [
  { id: 'UCqK_GSMbpiV8spgD3ZGloSw', name: 'Coin Bureau' },
  { id: 'UCAl9Ld79qaZxp9JzEOwd3aA', name: 'Bankless' },
  { id: 'UCL0J4MLEdLP0-UyLu0hCktg', name: 'The Defiant' },
  { id: 'UCGXWKlq1Oxr3ddEtmKhAkPg', name: 'Real Vision' },
  { id: 'UCVFSzL3VuZKP3cN9IXdLOtw', name: 'Raoul Pal' },
  { id: 'UCevXpeL8cNyAnww-NqJ4m2w', name: 'Anthony Pompliano' },
  { id: 'UCRvqjQPSeaWn-uEx-w0XOIg', name: 'Benjamin Cowen' },
  { id: 'UCtvg5cXLY_tHDJeBoRySBtg', name: 'What Bitcoin Did' },
  { id: 'UCbLhGKVY-bJPcawebgtNfbw', name: 'Altcoin Daily' },
  { id: 'UCh1ob28ceGdqohUnR7vBACA', name: 'Finematics' },
  { id: 'UCCatR7nWbYrkVXdxXb4cGXw', name: 'DataDash' },
  { id: 'UCN9Nj4tjXbVTLYWN0EKly_Q', name: 'Crypto Banter' },
  { id: 'UCl2oCaw8hdR_kbqyqd2klIA', name: 'Lark Davis' },
  { id: 'UChzLnWVsl3puKQwc5PoO6Zg', name: 'BTC Sessions' },
  { id: 'UCIEvlRpHBVFthrF6pZzBEXw', name: 'MoneyZG' },
  { id: 'UCiUnrCUGCJTCC7KjuW493Ww', name: 'Brian Jung' },
];

// Broader LIVE pool: premium set + reputable crypto channels that livestream
// frequently. Verified channel ids, 2026-06-17. Finance-only (no Twitch junk).
const LIVE_CHANNELS = [
  ...PREMIUM_CHANNELS,
  { id: 'UC4VPa7EOvObpyCRI4YKRQRw', name: 'Paul Barron Network' },
  { id: 'UCjemQfjaXAzA-95RKoy9n_g', name: 'Discover Crypto' },
  { id: 'UCjpkwsuHgYx9fBE0ojsJ_-w', name: 'Thinking Crypto' },
  { id: 'UCc4Rz_T9Sb1w5rqqo9pL1Og', name: 'The Moon' },
  { id: 'UCd4Ys__EL_gbJrYq6JscrAw', name: 'Cheeky Crypto' },
  { id: 'UCGyqEtcGQQtXyUwvcy7Gmyg', name: 'Altcoin Buzz' },
  { id: 'UClgJyzwGs-GyaNxUHcLZrkg', name: 'InvestAnswers' },
];

// Curated PREMIUM crypto podcasts — Podcast Index search terms for known shows.
// Search TERMS, not ids — Podcast Index resolves each to a feed. A term that
// stops matching costs one empty result, never a broken card, which is why this
// list can grow without a verification pass on fragile show ids.
const CURATED_PODCASTS = [
  // Crypto majors
  'Bankless', 'The Rollup crypto', 'Empire Blockworks', 'UpOnly',
  'Unchained Laura Shin', 'Unconfirmed Laura Shin', 'The Defiant',
  'What Bitcoin Did', 'Lightspeed Solana', 'Bell Curve crypto',
  'On The Brink crypto', 'Forward Guidance Blockworks', 'The Breakdown NLW',
  'Coin Stories Natalie Brunell', 'Epicenter crypto', '1000x Blockworks',
  'The Pomp Podcast', '0xResearch Blockworks', 'Supply Shock bitcoin',
  'The Chopping Block crypto', 'Uncommon Core crypto', 'Zero Knowledge podcast',
  'The Gwart Show', 'Blockworks Roundup', 'Coinage crypto',
  'Crypto Critics Corner', 'Mt Pelerin bitcoin', 'The Mining Pod',
  'Solana Podcast', 'Hidden Forces macro', 'Bitcoin Fundamentals Preston Pysh',
  'Stephan Livera Podcast', 'Bitcoin Audible', 'The Bitcoin Standard Podcast',
  // Macro / TradFi that moves crypto
  'Odd Lots Bloomberg', 'Macro Voices', 'Forward Guidance macro',
  'The Market Huddle', 'Real Vision daily briefing', 'Monetary Matters',
  'Excess Returns investing', 'Capital Allocators',
  // Tech / AI adjacent
  'a16z Podcast', 'Lex Fridman Podcast', 'All-In Podcast',
  'Acquired podcast', 'The Information Weekend',
];

// The keyless lane. Podcast Index needs an API key that has never been set in
// any environment, so `getCuratedPodcastItems` used to return [] forever and
// every podcast surface rendered empty. These are the same shows, resolved once
// to their PUBLISHER RSS feeds (via Apple's catalogue, ids kept for reference)
// so the feed needs no credentials, no shared rate limit, and no third party
// between us and the audio. Podcast Index still wins when a key exists.
// KEEP IN SYNC with packages/server/routes/media.js.
const PODCAST_FEEDS = [
  // Crypto majors
  { id: '1499409058', name: 'Bankless', feedUrl: 'https://feeds.flightcast.com/p83fuj0y0u58o82l41xei7zo.xml' },
  { id: '1523220564', name: 'The Rollup', feedUrl: 'https://anchor.fm/s/f3eccd24/podcast/rss' },
  { id: '1554930038', name: 'Empire', feedUrl: 'https://feeds.megaphone.fm/empire' },
  { id: '1554387610', name: 'UpOnly', feedUrl: 'https://feeds.simplecast.com/puPuLj25' },
  { id: '1123922160', name: 'Unchained', feedUrl: 'https://feeds.megaphone.fm/LSHML4761942757' },
  { id: '1347049808', name: 'Unconfirmed', feedUrl: 'https://feeds.megaphone.fm/LSHML3526213761' },
  { id: '1512654905', name: 'The Defiant', feedUrl: 'https://anchor.fm/s/1bee9344/podcast/rss' },
  { id: '1482455669', name: 'What Bitcoin Did', feedUrl: 'https://feeds.fountain.fm/UZSKQcrOnhqYS1JopxGg' },
  { id: '1697548240', name: 'Lightspeed', feedUrl: 'https://feeds.megaphone.fm/lightspeed' },
  { id: '1641356619', name: 'Bell Curve', feedUrl: 'https://feeds.megaphone.fm/bellcurve' },
  { id: '1480586463', name: 'On The Brink with Castle Island', feedUrl: 'https://rss.libsyn.com/shows/214379/destinations/1552766.xml' },
  { id: '1592743188', name: 'Forward Guidance', feedUrl: 'https://feeds.megaphone.fm/forwardguidance' },
  { id: '1438693620', name: 'The Breakdown', feedUrl: 'https://feeds.megaphone.fm/NLWLLC2118417614' },
  { id: '1569130932', name: 'Coin Stories', feedUrl: 'https://rss.libsyn.com/shows/344543/destinations/2813255.xml' },
  { id: '792338939', name: 'Epicenter', feedUrl: 'https://anchor.fm/s/10901e500/podcast/rss' },
  { id: '1791150637', name: '1000x', feedUrl: 'https://anchor.fm/s/112316ec0/podcast/rss' },
  { id: '1434060078', name: 'The Pomp Podcast', feedUrl: 'https://anchor.fm/s/b4841110/podcast/rss' },
  { id: '1651683074', name: '0xResearch', feedUrl: 'https://feeds.megaphone.fm/0xresearch' },
  { id: '1517659188', name: 'Uncommon Core', feedUrl: 'https://anchor.fm/s/2578d5a0/podcast/rss' },
  { id: '1326503043', name: 'Zero Knowledge', feedUrl: 'https://feeds.captivate.fm/zeroknowledge/' },
  { id: '1725892826', name: 'The Gwart Show', feedUrl: 'https://feeds.megaphone.fm/thegwartshow' },
  { id: '1557045965', name: "Crypto Critics' Corner", feedUrl: 'https://anchor.fm/s/4fa795b4/podcast/rss' },
  { id: '1561244346', name: 'The Mining Pod', feedUrl: 'https://feeds.megaphone.fm/theminingpod' },
  { id: '1415720320', name: 'Stephan Livera Podcast', feedUrl: 'https://anchor.fm/s/7d083a4/podcast/rss' },
  { id: '1359544516', name: 'Bitcoin Audible', feedUrl: 'https://feeds.fountain.fm/jju8hH7aXnP0afzXN7GS' },
  { id: '1403202032', name: 'The Bitcoin Standard Podcast', feedUrl: 'https://rss.buzzsprout.com/1849151.rss' },
  { id: '1500066831', name: 'The Wolf Of All Streets', feedUrl: 'https://feeds.megaphone.fm/wolfofallstreets' },
  // Macro / TradFi that moves crypto
  { id: '1056200096', name: 'Odd Lots', feedUrl: 'https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/8a94442e-5a74-4fa2-8b8d-ae27003a8d6b/982f5071-765c-403d-969d-ae27003a8d83/podcast.rss' },
  { id: '1079172742', name: 'Macro Voices', feedUrl: 'https://feed.podbean.com/macrovoices/feed.xml' },
  { id: '1444520320', name: 'The Market Huddle', feedUrl: 'https://markethuddle.com/feed/podcast/' },
  { id: '1210383304', name: 'Real Vision', feedUrl: 'https://feeds.megaphone.fm/realvision' },
  { id: '1769093906', name: 'Monetary Matters', feedUrl: 'https://feeds.megaphone.fm/EWWMN1909747317' },
  { id: '1490296778', name: 'Excess Returns', feedUrl: 'https://anchor.fm/s/9a1dfac/podcast/rss' },
  { id: '1223764016', name: 'Capital Allocators', feedUrl: 'https://rss.libsyn.com/shows/94820/destinations/482814.xml' },
  { id: '1205359334', name: 'Hidden Forces', feedUrl: 'https://rss.libsyn.com/shows/91567/destinations/457899.xml' },
  { id: '928933489', name: 'We Study Billionaires', feedUrl: 'https://feeds.megaphone.fm/PPLLC8974708240' },
  // Tech / AI adjacent
  { id: '842818711', name: 'The a16z Show', feedUrl: 'https://feeds.simplecast.com/JGE3yC0V' },
  { id: '1434243584', name: 'Lex Fridman Podcast', feedUrl: 'https://lexfridman.com/feed/podcast/' },
  { id: '1502871393', name: 'All-In', feedUrl: 'https://rss.libsyn.com/shows/254861/destinations/1928300.xml' },
  { id: '1050462261', name: 'Acquired', feedUrl: 'https://feeds.transistor.fm/acquired' },
];
const MAJOR_SYMBOLS = new Set([
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','MATIC',
  'LINK','UNI','ATOM','FIL','APT','ARB','OP','SUI','SEI','TIA',
  'FET','RNDR','INJ','NEAR','AAVE','MKR','CRV','LDO','PEPE','WIF',
  'BONK','FLOKI','STX','ONDO','IMX','SAND','MANA','AXS','GRT','SNX',
]);

// ─── In-Memory Cache ─────────────────────────────────────────────────────────

const mediaCache = new Map();

function getCached(key, ttlMs) {
  const entry = mediaCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  return { data: entry.data, stale: age > ttlMs, age };
}

function setCache(key, data) {
  mediaCache.set(key, { data, timestamp: Date.now() });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTokenTags(text) {
  if (!text) return [];
  const upper = text.toUpperCase();
  return [...MAJOR_SYMBOLS].filter(sym => {
    const re = new RegExp(`\\b${sym}\\b|\\$${sym}\\b`, 'i');
    return re.test(upper);
  });
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) to seconds.
 */
function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function buildMeta(source, cached, lastRefreshed, nextPage = null) {
  return { source, cached, lastRefreshed, nextPage };
}

/**
 * Detect if a video is likely a YouTube Short based on title patterns.
 * Many creators use specific patterns for shorts: hashtags, very short titles,
 * heavy emoji usage, or specific keywords.
 */
function detectShort(title) {
  if (!title) return false;
  // Explicit #shorts tag
  if (/#shorts?\b/i.test(title)) return true;
  // Very short title (<=40 chars) with emoji — common shorts pattern
  const emojiCount = (title.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (title.length <= 40 && emojiCount >= 2) return true;
  // Title is very short and ALL CAPS or mostly caps (common shorts style)
  if (title.length <= 35) {
    const upper = title.replace(/[^a-zA-Z]/g, '');
    if (upper.length > 5 && upper === upper.toUpperCase()) return true;
  }
  return false;
}

/**
 * Check if a video is a YouTube Short by probing the /shorts/ URL.
 * Free, no API quota needed. Returns true if the URL resolves as a Short.
 */
async function isYouTubeShort(videoId) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpectreAI/1.0)' },
    });
    clearTimeout(timeoutId);
    if (res.status === 200) return true;
    const loc = res.headers.get('location') || '';
    if (res.status === 303 && loc.includes('/shorts/')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Batch-check which videos are shorts using URL probing.
 * Processes in batches to avoid overwhelming the network.
 */
async function detectShortsFromURLs(videoIds, concurrency = 10) {
  const shorts = new Set();
  for (let i = 0; i < videoIds.length; i += concurrency) {
    const batch = videoIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (id) => ({ id, isShort: await isYouTubeShort(id) }))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.isShort) {
        shorts.add(r.value.id);
      }
    }
  }
  return shorts;
}

/**
 * Keywords that indicate finance/markets/crypto content.
 * Used to filter news channel videos — they post about everything,
 * we only want financial content.
 */
const FINANCE_KEYWORDS_RE = /\bcrypto|bitcoin|btc|ethereum|eth|blockchain|defi|web3|nft|market|stock|invest|economy|finance|fed\b|inflation|tariff|trade|recession|earnings|revenue|profit|gdp|treasury|dividend|rally|crash|bull|bear|portfolio|wallet|exchange|mining|token|coin|stablecoin|yield|bonds?|equity|nasdaq|s&p|dow\s*jones|wall\s*street|bank|central\s*bank|monetary|fiscal|rate\s*hike|rate\s*cut|oil|gold|commodity|forex|ipo|merger|acquisition|sec\b|regulation|senate|congress|funding|startup|vc\b|venture|valuation|billion|trillion|million\b/i;

/**
 * Decode basic HTML entities from RSS feed content.
 */
function decodeHTMLEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'");
}

// ─── Category + description derivation (Rollup-style metadata) ────────────────

// Derive a single primary category label from title + description text.
// First match wins (order matters — more specific topics before broad ones).
const CATEGORY_RULES = [
  ['Stablecoins', /\bstablecoins?\b|\busdt\b|\busdc\b|\bdai\b|\btether\b|\bcircle\b/i],
  ['Bitcoin',     /\bbitcoin\b|\bbtc\b|\bsatoshi\b|\bordinals?\b/i],
  ['Ethereum',    /\bethereum\b|\beth\b|\bvitalik\b|\bl2\b|\brollups?\b|\bstaking\b/i],
  ['Solana',      /\bsolana\b|\bsol\b|\bphantom\b|\bjupiter\b/i],
  ['RWAs',        /\brwa\b|\breal[-\s]?world assets?\b|\btokeniz/i],
  ['DeFi',        /\bdefi\b|\byield\b|\bliquidity\b|\bamm\b|\blending\b|\bdex\b|\baave\b|\buniswap\b/i],
  ['NFTs',        /\bnfts?\b|\bnon[-\s]?fungible\b|\bopensea\b|\bpfp\b/i],
  ['Regulation',  /\bregulation\b|\bsec\b|\blawsuit\b|\bcongress\b|\bsenate\b|\bcftc\b|\bpolicy\b|\bcompliance\b/i],
  ['Macro',       /\bmacro\b|\bfed\b|\binflation\b|\brate\s?cut\b|\brate\s?hike\b|\brecession\b|\bgdp\b|\btreasury\b|\bgold\b|\bliquidity cycle\b/i],
  ['AI',          /\bai\b|\bartificial intelligence\b|\bagents?\b|\bllm\b|\bmachine learning\b/i],
  ['Trading',     /\btrading\b|\bta\b|\bchart\b|\bsetup\b|\bbreakout\b|\bsupport\b|\bresistance\b|\bscalp/i],
  ['Altcoins',    /\baltcoins?\b|\bmemecoins?\b|\bmemes?\b|\bgems?\b|\blow[-\s]?cap\b/i],
];

function deriveCategory(text) {
  if (!text) return 'Markets';
  for (const [label, re] of CATEGORY_RULES) {
    if (re.test(text)) return label;
  }
  return 'Markets';
}

// Trim a description/snippet to a short thesis subtitle (<=180 chars, single line).
function trimDescription(text, max = 180) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + '…';
}

// ─── Podcast Index HMAC Auth + normalizer ────────────────────────────────────

function podcastIndexHeaders() {
  const apiKey = process.env.PODCAST_INDEX_KEY;
  const apiSecret = process.env.PODCAST_INDEX_SECRET;
  if (!apiKey || !apiSecret) throw new Error('Podcast Index credentials not configured');
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(apiKey + apiSecret + ts).digest('hex');
  return {
    'X-Auth-Key': apiKey,
    'X-Auth-Date': String(ts),
    'Authorization': hash,
    'User-Agent': 'SpectreAI/1.0',
  };
}

// The podcast namespace ships <podcast:transcript> per episode. Podcast Index
// exposes it as `transcripts[]` (newer) or a bare `transcriptUrl` (older). This
// is the ONLY real caption source we have — where a show publishes none, the
// player says so rather than inventing lines.
function pickTranscripts(ep) {
  const out = [];
  const seen = new Set();
  const push = (url, type) => {
    if (!url || typeof url !== 'string' || seen.has(url)) return;
    if (!/^https?:\/\//i.test(url)) return;
    seen.add(url);
    out.push({ url, type: (type || '').toLowerCase() });
  };
  if (Array.isArray(ep.transcripts)) {
    for (const tr of ep.transcripts) push(tr?.url, tr?.type);
  }
  push(ep.transcriptUrl, '');
  // Timed formats first — a plain-text transcript can't drive live captions.
  const rank = (t) => (
    t.includes('json') ? 0 : t.includes('vtt') ? 1 : t.includes('srt') ? 2 : t.includes('html') ? 4 : 3
  );
  return out.sort((a, b) => rank(a.type) - rank(b.type)).slice(0, 4);
}

function normalizePodcastEpisode(ep) {
  const title = ep.title || '';
  const description = ep.description || '';
  const transcripts = pickTranscripts(ep);
  return {
    id: `pod_ep_${ep.id}`,
    type: 'podcast',
    source: 'podcast-index',
    title,
    thumbnail: ep.image || ep.feedImage || '',
    channel: {
      name: ep.feedTitle || ep.feedAuthor || '',
      avatar: ep.feedImage || '',
      url: ep.link || '',
    },
    duration: ep.duration || 0,
    publishedAt: ep.datePublished
      ? new Date(ep.datePublished * 1000).toISOString()
      : new Date().toISOString(),
    viewCount: 0,
    url: ep.link || '',
    audioUrl: ep.enclosureUrl || null,
    tags: extractTokenTags(`${title} ${description}`),
    description: trimDescription(description),
    // The immersive player has room for the real show notes; the cards keep
    // using the trimmed `description` above.
    notes: decodeHTMLEntities(String(description).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 2400),
    category: deriveCategory(`${title} ${description}`),
    feedId: ep.feedId,
    episode: ep.episode || null,
    season: ep.season || null,
    explicit: !!ep.explicit,
    transcripts,
    hasTranscript: transcripts.length > 0,
    chaptersUrl: ep.chaptersUrl || null,
  };
}

// ─── Channel Seed ────────────────────────────────────────────────────────────

let _channelSeed = null;

function loadChannelSeed() {
  if (_channelSeed) return _channelSeed;
  const seedPath = path.join(__dirname, '../data/crypto-channels.json');
  try {
    _channelSeed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch (err) {
    console.error('[media] Failed to load crypto-channels.json:', err.message);
    _channelSeed = { youtube: [], twitch: [] };
  }
  return _channelSeed;
}

// ─── YouTube RSS Feed Parser ─────────────────────────────────────────────────

/**
 * Fetch and parse a YouTube channel's RSS feed.
 * Returns up to 15 recent videos (YouTube RSS limit).
 * FREE — no API key, no quota.
 */
async function fetchChannelRSS(channelId, channelName = '', category = 'crypto') {
  const cacheKey = `rss:${channelId}`;
  const cached = getCached(cacheKey, TTL.RSS_FEED);
  if (cached && !cached.stale) return cached.data;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const xml = await res.text();
    const entries = parseRSSEntries(xml, channelName, channelId, category);
    setCache(cacheKey, entries);
    return entries;
  } catch {
    return [];
  }
}

/**
 * Parse YouTube RSS XML into normalized video entries.
 */
function parseRSSEntries(xml, channelName, channelId, category) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  // Extract channel name from feed if not provided
  if (!channelName) {
    const feedTitle = xml.match(/<feed[^>]*>[\s\S]*?<title>([^<]+)<\/title>/);
    if (feedTitle) channelName = decodeHTMLEntities(feedTitle[1]);
  }

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = entry.match(/<title>([^<]+)<\/title>/)?.[1];
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    const thumbnail = entry.match(/<media:thumbnail url="([^"]+)"/)?.[1];
    const viewsMatch = entry.match(/<media:statistics views="(\d+)"/);
    const views = viewsMatch ? parseInt(viewsMatch[1], 10) : 0;
    const authorName = entry.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1];
    const rawDescription = entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1];

    if (videoId && title) {
      const decodedTitle = decodeHTMLEntities(title);
      const decodedDesc = decodeHTMLEntities(rawDescription || '');
      const text = `${decodedTitle} ${decodedDesc} ${channelName}`;
      entries.push({
        id: `yt_${videoId}`,
        videoId,
        type: 'video',
        source: 'youtube',
        title: decodedTitle,
        thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        channel: {
          name: decodeHTMLEntities(authorName || channelName),
          avatar: '',
          url: `https://www.youtube.com/channel/${channelId}`,
        },
        duration: 0,  // RSS doesn't provide duration
        publishedAt: published || new Date().toISOString(),
        viewCount: views,
        url: `https://www.youtube.com/embed/${videoId}`,
        audioUrl: null,
        tags: extractTokenTags(text),
        description: trimDescription(decodedDesc),
        primaryCategory: deriveCategory(`${decodedTitle} ${decodedDesc}`),
        category,
        _isShort: detectShort(decodedTitle),
      });
    }
  }

  return entries;
}

/**
 * Fetch RSS feeds from multiple channels concurrently.
 * Uses batched concurrency to avoid overwhelming the network.
 */
async function fetchMultipleChannelRSS(channels, concurrency = 15) {
  const results = [];
  for (let i = 0; i < channels.length; i += concurrency) {
    const batch = channels.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(ch => fetchChannelRSS(ch.id, ch.name, ch.category || 'crypto'))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(...r.value);
      }
    }
  }
  return results;
}

// ─── YouTube Data API (optional enrichment) ──────────────────────────────────

/**
 * Batch-fetch video details (duration, stats) for up to 50 video IDs.
 * Returns empty map if API key not available or quota exceeded.
 */
async function ytVideoDetails(ids) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !ids.length) return {};
  try {
    const params = new URLSearchParams({
      part: 'contentDetails,statistics',
      id: ids.join(','),
      key: apiKey,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const item of (data.items || [])) {
      map[item.id] = {
        duration: parseDuration(item.contentDetails?.duration),
        viewCount: parseInt(item.statistics?.viewCount || '0', 10),
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Fetch live-stream details for a set of video ids. For each returned video build
 * a map keyed by id: { liveState, concurrent, startedAt, viewCount, snippet }.
 * Returns {} on any failure (missing key, no ids, upstream error) — never throws.
 */
async function ytVideoLiveDetails(ids) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !ids.length) return {};
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const params = new URLSearchParams({
        part: 'snippet,liveStreamingDetails,statistics',
        id: chunk.join(','),
        key: apiKey,
      });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of (data.items || [])) {
        map[item.id] = {
          liveState: item.snippet?.liveBroadcastContent,
          concurrent: parseInt(item.liveStreamingDetails?.concurrentViewers || '0', 10),
          startedAt: item.liveStreamingDetails?.actualStartTime,
          viewCount: parseInt(item.statistics?.viewCount || '0', 10),
          snippet: item.snippet,
        };
      }
    } catch {
      // tolerate — chunk just contributes nothing
    }
  }
  return map;
}

/**
 * Optionally enrich videos with duration/viewCount from YouTube API.
 * Gracefully degrades — if API fails, returns original items unchanged.
 */
async function enrichWithDetails(items) {
  if (!items.length) return items;
  const rawIds = items.slice(0, 50).map(i => i.videoId || i.id.replace('yt_', '')).filter(Boolean);
  if (!rawIds.length) return items;

  const details = await ytVideoDetails(rawIds);
  if (!Object.keys(details).length) return items;

  return items.map(item => {
    const rawId = item.videoId || item.id.replace('yt_', '');
    const det = details[rawId];
    if (!det) return item;
    return {
      ...item,
      duration: det.duration || item.duration,
      viewCount: det.viewCount || item.viewCount,
    };
  });
}

// ─── Twitch OAuth ────────────────────────────────────────────────────────────

let twitchToken = null;
let twitchTokenExpiry = 0;

async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchTokenExpiry) return twitchToken;
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Twitch credentials not configured');
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
  });
  if (!res.ok) throw new Error(`Twitch OAuth failed: ${res.status}`);
  const data = await res.json();
  twitchToken = data.access_token;
  twitchTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return twitchToken;
}

// ─── Spotify OAuth (client-credentials) ──────────────────────────────────────

let spotifyToken = null;
let spotifyTokenExp = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('spotify-not-configured');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify OAuth failed: ${res.status}`);
  const data = await res.json();
  spotifyToken = data.access_token;
  spotifyTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

// ─── Twitch Helpers ──────────────────────────────────────────────────────────

function normalizeTwitchStream(stream) {
  const text = `${stream.title || ''} ${(stream.tags || []).join(' ')}`;
  const thumb = (stream.thumbnail_url || '').replace('{width}', '320').replace('{height}', '180');
  return {
    id: `tw_${stream.id}`,
    type: 'live',
    source: 'twitch',
    title: stream.title || '',
    thumbnail: thumb,
    channel: {
      name: stream.user_name || stream.user_login || '',
      avatar: '',
      url: `https://www.twitch.tv/${stream.user_login}`,
    },
    duration: 0,
    publishedAt: stream.started_at || new Date().toISOString(),
    viewCount: stream.viewer_count || 0,
    url: `https://player.twitch.tv/?channel=${stream.user_login}&parent=app.spectreai.io&parent=spectre-app-research.vercel.app&parent=localhost&autoplay=true&muted=false`,
    audioUrl: null,
    tags: extractTokenTags(text),
  };
}

// ─── YouTube Routes ──────────────────────────────────────────────────────────

/**
 * GET /api/media/youtube/videos
 * Aggregates recent videos from curated channels via RSS feeds.
 * Free, no quota, always works.
 */
router.get('/youtube/videos', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const page = parseInt(req.query.page || '1', 10);
  const perPage = 24;
  const cacheKey = 'yt_videos_rss';

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.YT_VIDEOS);
    if (cached && !cached.stale) {
      const allItems = cached.data;
      const start = (page - 1) * perPage;
      const pageItems = allItems.slice(start, start + perPage);
      const hasMore = start + perPage < allItems.length;
      return res.json({
        items: pageItems,
        meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString(), hasMore ? String(page + 1) : null),
      });
    }
  }

  try {
    const seed = loadChannelSeed();
    const channels = seed.youtube || [];

    // Fetch RSS from all curated channels
    const allEntries = await fetchMultipleChannelRSS(channels);

    // Filter: only regular videos (not shorts)
    // For news channels, only keep finance/market-related content
    const videos = allEntries
      .filter(e => {
        if (e._isShort) return false;
        if (e.category === 'news') {
          return FINANCE_KEYWORDS_RE.test(e.title);
        }
        return true;
      })
      .sort((a, b) => {
        // Prioritize: crypto > finance > stocks > news
        const priority = { crypto: 0, finance: 1, stocks: 1, news: 2 };
        const pa = priority[a.category] ?? 1;
        const pb = priority[b.category] ?? 1;
        if (pa !== pb) return pa - pb;
        return new Date(b.publishedAt) - new Date(a.publishedAt);
      });

    // Remove internal fields; expose the derived topic label as `category`
    const cleaned = videos.map(({ _isShort, videoId, category, primaryCategory, ...rest }) => ({ ...rest, category: primaryCategory }));

    // Try to enrich the first page with durations (optional, graceful)
    const firstPage = cleaned.slice(0, perPage);
    const enriched = await enrichWithDetails(firstPage);
    const restItems = cleaned.slice(perPage);
    const allItems = [...enriched, ...restItems];

    setCache(cacheKey, allItems);

    const hasMore = perPage < allItems.length;
    res.json({
      items: enriched,
      meta: buildMeta('youtube', false, new Date().toISOString(), hasMore ? '2' : null),
    });
  } catch (err) {
    console.error('[media] youtube/videos error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/media/youtube/shorts
 * Aggregates shorts from curated channels via RSS feeds.
 */
router.get('/youtube/shorts', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const page = parseInt(req.query.page || '1', 10);
  const perPage = 20;
  const cacheKey = 'yt_shorts_rss';

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.YT_SHORTS);
    if (cached && !cached.stale) {
      const allItems = cached.data;
      const start = (page - 1) * perPage;
      const pageItems = allItems.slice(start, start + perPage);
      const hasMore = start + perPage < allItems.length;
      return res.json({
        items: pageItems,
        meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString(), hasMore ? String(page + 1) : null),
      });
    }
  }

  try {
    const seed = loadChannelSeed();
    const channels = seed.youtube || [];

    const allEntries = await fetchMultipleChannelRSS(channels);

    // First pass: title-based detection
    let candidates = allEntries.filter(e => e._isShort);

    // If we found very few by title, use URL-based detection on recent videos
    if (candidates.length < 10) {
      // Check recent videos from all channels that aren't already detected
      const unchecked = allEntries
        .filter(e => !e._isShort)
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, 60); // Check 60 most recent

      const ids = unchecked.map(e => e.videoId).filter(Boolean);
      const shortsSet = await detectShortsFromURLs(ids);

      const urlDetected = unchecked.filter(e => shortsSet.has(e.videoId));
      candidates = [...candidates, ...urlDetected];
    }

    const rssShorts = candidates
      .map(({ _isShort, videoId, category, primaryCategory, ...rest }) => ({ ...rest, type: 'short', category: primaryCategory }))
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // This RSS route has no user search query → premium-channel shorts FIRST
    // (quality, real <=60s API-verified), then top up with the RSS-detected shorts
    // for volume, deduped by id. Tolerates premium failure → RSS-only.
    let premium = [];
    try {
      premium = await getPremiumShortItems(24);
    } catch {
      premium = [];
    }
    const seen = new Set(premium.map(s => s.id));
    const topUp = rssShorts.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    const shorts = [...premium, ...topUp];

    setCache(cacheKey, shorts);

    const pageItems = shorts.slice(0, perPage);
    const hasMore = perPage < shorts.length;
    res.json({
      items: pageItems,
      meta: buildMeta('youtube', false, new Date().toISOString(), hasMore ? '2' : null),
    });
  } catch (err) {
    console.error('[media] youtube/shorts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Source live streams from the curated premium channels (NOT a junk keyword search).
 * Pull each channel's most-recent uploads, probe their live-stream details, keep only
 * those currently live, normalize to media items. Tolerates every failure → [].
 */
async function getPremiumLiveItems(refresh = false) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !LIVE_CHANNELS.length) return [];

  const cacheKey = 'premium_live';
  if (!refresh) {
    const cached = getCached(cacheKey, TTL.LIVE_PREMIUM);
    if (cached && !cached.stale) return cached.data;
  }

  // Collect candidate videoIds from the latest uploads of each live channel.
  const settled = await Promise.allSettled(
    LIVE_CHANNELS.map(ch => fetchChannelUploads(ch.id, 3))
  );
  const ids = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    for (const pi of r.value) {
      const videoId = pi.snippet?.resourceId?.videoId;
      if (videoId) ids.push(videoId);
    }
  }
  if (!ids.length) {
    setCache(cacheKey, []);
    return [];
  }

  let liveMap;
  try {
    liveMap = await ytVideoLiveDetails(ids);
  } catch {
    return [];
  }

  const items = [];
  for (const id of ids) {
    const det = liveMap[id];
    if (!det || det.liveState !== 'live') continue;
    const snippet = det.snippet || {};
    const title = snippet.title || '';
    const description = snippet.description || '';
    const text = `${title} ${description} ${(snippet.tags || []).join(' ')}`;
    items.push({
      id: `yt_${id}`,
      type: 'live',
      source: 'youtube',
      title,
      thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
      channel: {
        name: snippet.channelTitle || '',
        avatar: '',
        url: `https://www.youtube.com/channel/${snippet.channelId}`,
      },
      duration: 0,
      publishedAt: det.startedAt || snippet.publishedAt || new Date().toISOString(),
      viewCount: det.concurrent || det.viewCount || 0,
      url: `https://www.youtube.com/embed/${id}`,
      audioUrl: null,
      tags: extractTokenTags(text),
      description: trimDescription(description),
      category: deriveCategory(`${title} ${description}`),
    });
  }

  // Dedup by id, sort by viewCount (concurrent) desc.
  const seen = new Set();
  const deduped = items.filter(it => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
  deduped.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));

  setCache(cacheKey, deduped);
  return deduped;
}

/**
 * GET /api/media/youtube/live
 * Live crypto streams sourced from the curated premium channels (premium-channel
 * live, NOT the old junk `crypto live stream` keyword search). Never throws.
 */
router.get('/youtube/live', async (req, res) => {
  try {
    const items = await getPremiumLiveItems(req.query.refresh === 'true');
    res.json({ items, meta: buildMeta('youtube', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] youtube/live error:', err.message);
    res.json({ items: [], meta: buildMeta('youtube', false, new Date().toISOString()) });
  }
});

/**
 * GET /api/media/youtube/comments?videoId=<id>
 * Top-level comment threads for a video (the player's live-comments panel).
 * Tolerates 403 / comments-disabled / any error → { items: [], meta }. NEVER throws.
 */
router.get('/youtube/comments', async (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId) {
    return res.json({ items: [], meta: buildMeta('youtube', false, new Date().toISOString()) });
  }

  const cacheKey = `yt_comments:${videoId}`;
  const refresh = req.query.refresh === 'true';
  if (!refresh) {
    const cached = getCached(cacheKey, TTL.COMMENTS);
    if (cached && !cached.stale) {
      return res.json({
        items: cached.data,
        meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString()),
      });
    }
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.json({ items: [], meta: buildMeta('youtube', false, new Date().toISOString()) });
  }

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      videoId,
      order: 'relevance',
      maxResults: '25',
      textFormat: 'plainText',
      key: apiKey,
    });
    const apiRes = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${params}`);
    if (!apiRes.ok) {
      // 403 (comments disabled / quota), 404, etc. — degrade to empty.
      return res.json({ items: [], meta: buildMeta('youtube', false, new Date().toISOString()) });
    }
    const data = await apiRes.json();
    const items = (data.items || []).map(thread => {
      const tlc = thread.snippet?.topLevelComment?.snippet || {};
      return {
        id: thread.id,
        author: tlc.authorDisplayName,
        avatarUrl: tlc.authorProfileImageUrl,
        text: tlc.textDisplay,
        likeCount: tlc.likeCount || 0,
        publishedAt: tlc.publishedAt,
      };
    });

    setCache(cacheKey, items);
    res.json({ items, meta: buildMeta('youtube', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] youtube/comments error:', err.message);
    res.json({ items: [], meta: buildMeta('youtube', false, new Date().toISOString()) });
  }
});

/**
 * GET /api/media/youtube/channel/:channelId
 * Fetch videos from a specific channel via RSS feed.
 */
router.get('/youtube/channel/:channelId', async (req, res) => {
  const channelId = req.params.channelId;

  try {
    const entries = await fetchChannelRSS(channelId, '', 'crypto');
    const videos = entries
      .filter(e => !e._isShort)
      .map(({ _isShort, videoId, category, primaryCategory, ...rest }) => ({ ...rest, category: primaryCategory }))
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Enrich with durations
    const enriched = await enrichWithDetails(videos);

    res.json({
      items: enriched,
      meta: buildMeta('youtube', false, new Date().toISOString()),
    });
  } catch (err) {
    console.error('[media] youtube/channel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Twitch Routes ───────────────────────────────────────────────────────────

// GET /api/media/twitch/live
// Twitch dropped as a live source. The only crypto-adjacent Twitch category was
// game_id 509670 ("Science & Technology"), which returns junk (seismic monitors,
// weather channels, 3D printing). No usable crypto category exists → return [].
// Route kept so the dev/prod contract stays valid. /twitch/clips is unaffected.
// Twitch's real "Crypto" category (NOT 509670 = Science & Technology junk).
const TWITCH_CRYPTO_GAME_ID = '499634';

router.get('/twitch/live', async (req, res) => {
  const cacheKey = 'twitch_live';
  const cached = getCached(cacheKey, TTL.TW_LIVE);
  if (cached && !cached.stale) {
    return res.json({ items: cached.data, meta: buildMeta('twitch', true, new Date(Date.now() - cached.age).toISOString()) });
  }
  let token;
  try { token = await getTwitchToken(); } catch { return res.json({ items: [], meta: buildMeta('twitch', false, new Date().toISOString()) }); }
  try {
    const r = await fetch(`https://api.twitch.tv/helix/streams?game_id=${TWITCH_CRYPTO_GAME_ID}&first=40`, {
      headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.json({ items: [], meta: buildMeta('twitch', false, new Date().toISOString()) });
    const data = await r.json();
    const items = (data.data || [])
      .filter(s => s.language === 'en' && (s.viewer_count || 0) >= 3)
      .slice(0, 16)
      .map(normalizeTwitchStream);
    setCache(cacheKey, items);
    res.json({ items, meta: buildMeta('twitch', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] twitch/live error:', err.message);
    res.json({ items: [], meta: buildMeta('twitch', false, new Date().toISOString()) });
  }
});

// ─── Channels Routes ─────────────────────────────────────────────────────────

/**
 * Try to scrape channel avatar from YouTube's public channel page.
 * Returns avatar URL or empty string on failure.
 */
async function scrapeChannelAvatar(channelId) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://www.youtube.com/channel/${channelId}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpectreAI/1.0)' },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return '';
    const html = await res.text();
    // YouTube embeds channel avatar in the page meta or JSON
    const ogMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogMatch) return ogMatch[1];
    const thumbMatch = html.match(/"avatar":\{"thumbnails":\[.*?"url":"([^"]+)"/);
    if (thumbMatch) return thumbMatch[1];
    return '';
  } catch {
    return '';
  }
}

/**
 * Enrich channel data from RSS feeds + avatar scraping — free, no quota.
 * Gets real channel name, latest video date, video count, and avatar.
 */
async function enrichChannelsFromRSS(channelIds, categoryMap) {
  const seed = loadChannelSeed();
  const nameMap = Object.fromEntries((seed.youtube || []).map(c => [c.id, c.name]));

  const results = await Promise.allSettled(
    channelIds.map(async (id) => {
      const [entries, avatar] = await Promise.all([
        fetchChannelRSS(id, nameMap[id] || '', categoryMap[id] || 'crypto'),
        scrapeChannelAvatar(id),
      ]);
      const realName = entries.length > 0 ? entries[0].channel.name : (nameMap[id] || id);
      const latestDate = entries.length > 0 ? entries[0].publishedAt : null;
      return {
        id: `yt_ch_${id}`,
        source: 'youtube',
        name: realName,
        description: '',
        avatar: avatar || '',
        banner: null,
        subscriberCount: 0,  // Honest: RSS doesn't provide sub counts
        videoCount: entries.length,
        lastUpload: latestDate,
        isLive: false,
        url: `https://www.youtube.com/channel/${id}`,
        category: categoryMap[id] || 'crypto',
      };
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

/**
 * Fetch enriched YouTube channel objects.
 * Primary: YouTube Data API (has avatars, sub counts).
 * Fallback: RSS feeds (always works, has real names + video counts).
 */
async function fetchYouTubeChannels(channelIds, categoryMap) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  // Try the YouTube API first
  if (apiKey && channelIds.length) {
    try {
      const batches = [];
      for (let i = 0; i < channelIds.length; i += 50) {
        batches.push(channelIds.slice(i, i + 50));
      }

      const results = [];
      for (const batch of batches) {
        const params = new URLSearchParams({
          part: 'snippet,statistics,brandingSettings',
          id: batch.join(','),
          key: apiKey,
        });
        const apiRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`);
        if (!apiRes.ok) throw new Error(`YouTube API ${apiRes.status}`);
        const data = await apiRes.json();
        for (const ch of (data.items || [])) {
          results.push({
            id: `yt_ch_${ch.id}`,
            source: 'youtube',
            name: ch.snippet?.title || ch.id,
            description: (ch.snippet?.description || '').slice(0, 200),
            avatar: ch.snippet?.thumbnails?.medium?.url || ch.snippet?.thumbnails?.default?.url || '',
            banner: ch.brandingSettings?.image?.bannerExternalUrl || null,
            subscriberCount: parseInt(ch.statistics?.subscriberCount || '0', 10),
            videoCount: parseInt(ch.statistics?.videoCount || '0', 10),
            lastUpload: null,
            isLive: false,
            url: `https://www.youtube.com/channel/${ch.id}`,
            category: categoryMap[ch.id] || 'crypto',
          });
        }
      }
      if (results.length > 0) return results;
    } catch (err) {
      console.error('[media] YouTube channels API failed, using RSS fallback:', err.message);
    }
  }

  // Fallback: enrich from RSS feeds (free, always works)
  return enrichChannelsFromRSS(channelIds, categoryMap);
}

// GET /api/media/channels
router.get('/channels', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const cacheKey = 'channels_all';

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.CHANNELS);
    if (cached && !cached.stale) {
      return res.json({
        items: cached.data,
        meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString()),
      });
    }
  }

  try {
    const seed = loadChannelSeed();
    const seenIds = new Set();
    const uniqueYt = (seed.youtube || []).filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    });
    const ytIds = uniqueYt.map(c => c.id);
    const categoryMap = Object.fromEntries(uniqueYt.map(c => [c.id, c.category || 'crypto']));

    const items = await fetchYouTubeChannels(ytIds, categoryMap);

    // Sort by subscriber count
    items.sort((a, b) => (b.subscriberCount || 0) - (a.subscriberCount || 0));

    setCache(cacheKey, items);
    res.json({ items, meta: buildMeta('youtube', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] channels error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── For You Feed ────────────────────────────────────────────────────────────

/**
 * GET /api/media/feed/for-you?tokens=BTC,ETH,SOL
 * Personalized feed based on user's watchlist tokens.
 * Uses RSS feeds from curated channels, filtered by token tags.
 */
router.get('/feed/for-you', async (req, res) => {
  const tokensParam = req.query.tokens || 'BTC,ETH,SOL';
  const tokens = tokensParam
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(t => t.length > 0)
    .slice(0, 10);

  const refresh = req.query.refresh === 'true';
  const cacheKey = `feed_for_you:${tokens.sort().join(',')}`;

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.FOR_YOU);
    if (cached && !cached.stale) {
      return res.json({
        items: cached.data,
        meta: buildMeta('mixed', true, new Date(Date.now() - cached.age).toISOString()),
      });
    }
  }

  try {
    const seed = loadChannelSeed();
    const channels = seed.youtube || [];

    // Fetch RSS from all channels
    const allEntries = await fetchMultipleChannelRSS(channels);

    // Filter for videos mentioning the user's tokens
    const tokenSet = new Set(tokens);
    const matching = allEntries
      .filter(e => !e._isShort && e.tags.some(t => tokenSet.has(t)))
      .map(({ _isShort, videoId, category, primaryCategory, ...rest }) => ({ ...rest, category: primaryCategory }))
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // If not enough token-specific results, pad with recent general content
    let results = matching;
    if (results.length < 10) {
      const existingIds = new Set(results.map(r => r.id));
      const general = allEntries
        .filter(e => !e._isShort && !existingIds.has(e.id))
        .map(({ _isShort, videoId, category, primaryCategory, ...rest }) => ({ ...rest, category: primaryCategory }))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, 20 - results.length);
      results = [...results, ...general];
    }

    // Enrich first batch
    const enriched = await enrichWithDetails(results.slice(0, 24));
    const final = [...enriched, ...results.slice(24)];

    setCache(cacheKey, final);
    res.json({ items: final.slice(0, 30), meta: buildMeta('youtube', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] feed/for-you error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Keyless RSS lane ─────────────────────────────────────────────────────────
// Podcast Index is an index OF these feeds, so reading the publisher feed
// directly loses nothing: same enclosure URL, same duration, same
// <podcast:transcript>. It also spreads the load over 40 hosts instead of one
// rate-limited API. KEEP IN SYNC with packages/server/routes/media.js.

const stripCData = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

function xmlTagText(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? decodeHTMLEntities(stripCData(m[1])).trim() : '';
}

function xmlAttr(xml, tag, name) {
  const m = xml.match(new RegExp('<' + tag + '\\b[^>]*\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
  return m ? decodeHTMLEntities(m[1]).trim() : '';
}

/* "1:02:03" | "12:34" | "4952" → seconds. Feeds use all three. */
function parseItunesDuration(raw) {
  if (!raw) return 0;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/* 🪤 A back catalogue can be tens of MB (Lex Fridman, All-In) and we only ever
   show the newest handful. Read the body as a STREAM and stop at the first
   `maxItems` </item> closes — reading to completion would blow the serverless
   time and memory budget on the few feeds that publish everything. */
async function fetchFeedHead(url, { maxBytes = 900000, maxItems = 8, timeoutMs = 6000 } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'SpectreAI/1.0 (+https://app.spectreai.io)',
      accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let xml = '';
  let bytes = 0;
  let items = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });
      items += (chunk.match(/<\/item>/gi) || []).length;
      xml += chunk;
      if (items >= maxItems || bytes >= maxBytes) break;
    }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
  return xml;
}

/* One <item> → the same shape normalizePodcastEpisode returns, so the player,
   the transcript route and every card consume it unchanged. */
function normalizeRssEpisode(block, show, feed) {
  const audioUrl = xmlAttr(block, 'enclosure', 'url');
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) return null;
  const title = xmlTagText(block, 'title');
  if (!title) return null;

  const description = xmlTagText(block, 'description') || xmlTagText(block, 'itunes:summary') || '';
  const published = xmlTagText(block, 'pubDate');
  const when = published ? new Date(published) : null;

  const transcripts = [];
  const seen = new Set();
  const trRe = /<podcast:transcript\b[^>]*>/gi;
  let m;
  while ((m = trRe.exec(block))) {
    const u = (m[0].match(/\burl\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!u) continue;
    const url = decodeHTMLEntities(u).trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const type = ((m[0].match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
    transcripts.push({ url, type });
  }
  const rank = (t) => (t.includes('json') ? 0 : t.includes('vtt') ? 1 : t.includes('srt') ? 2 : t.includes('html') ? 4 : 3);
  transcripts.sort((a, b) => rank(a.type) - rank(b.type));

  // The GUID is the feed's own stable episode key; hashing keeps the id short
  // and URL-safe while staying stable across refreshes (resume positions and
  // the "continue listening" rail are keyed on it).
  const guid = xmlTagText(block, 'guid') || audioUrl;
  const id = crypto.createHash('sha1').update(`${show.id}:${guid}`).digest('hex').slice(0, 16);
  const plain = decodeHTMLEntities(stripCData(description).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  return {
    id: `pod_ep_rss_${id}`,
    type: 'podcast',
    source: 'podcast-rss',
    title,
    thumbnail: xmlAttr(block, 'itunes:image', 'href') || feed.image || '',
    channel: { name: show.name, avatar: feed.image || '', url: feed.link || '' },
    duration: parseItunesDuration(xmlTagText(block, 'itunes:duration')),
    publishedAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : new Date().toISOString(),
    viewCount: 0,
    url: xmlTagText(block, 'link') || feed.link || '',
    audioUrl,
    tags: extractTokenTags(`${title} ${plain}`),
    description: trimDescription(plain),
    notes: plain.slice(0, 2400),
    category: deriveCategory(`${title} ${plain}`),
    feedId: show.id,
    episode: Number(xmlTagText(block, 'itunes:episode')) || null,
    season: Number(xmlTagText(block, 'itunes:season')) || null,
    explicit: /<itunes:explicit>\s*(yes|true)\s*<\/itunes:explicit>/i.test(block),
    transcripts: transcripts.slice(0, 4),
    hasTranscript: transcripts.length > 0,
    chaptersUrl: xmlAttr(block, 'podcast:chapters', 'url') || null,
    showTitle: show.name,
    showId: show.id,
  };
}

async function fetchShowFromRss(show) {
  const xml = await fetchFeedHead(show.feedUrl);
  if (!xml) return [];
  const cut = xml.search(/<item[\s>]/i);
  const head = cut > 0 ? xml.slice(0, cut) : xml;
  const feed = {
    image: xmlAttr(head, 'itunes:image', 'href') || xmlTagText(head, 'url') || '',
    link: xmlTagText(head, 'link') || '',
  }
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const ep = normalizeRssEpisode(b, show, feed);
    if (ep) out.push(ep)
  }
  return out;
}

/* All 40 shows through a real worker POOL, not lockstep Promise.allSettled
   waves. 🪤 With waves, one 9s host stalls the other seven slots for the whole
   wave — measured 24s wall on a bad run against 4s on a good one, and this
   function has a 30s ceiling. A pool lets a fast feed's slot start the next
   show immediately, so wall time tracks the AVERAGE feed, not the worst one in
   each of five waves. Per-feed failure costs that show and nothing else. */
async function getRssPodcastItems() {
  const all = [];
  const POOL = 12;
  let cursor = 0;
  const deadline = Date.now() + 20000;

  const worker = async () => {
    for (;;) {
      const show = PODCAST_FEEDS[cursor++];
      if (!show) return;
      // Whatever we have when the budget runs out beats a function timeout,
      // which would return NOTHING and cache nothing.
      if (Date.now() > deadline) return;
      try {
        const eps = await fetchShowFromRss(show);
        if (eps.length) all.push(...eps)
      } catch (err) {
        console.warn(`[media] rss feed failed (${show.name}):`, err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL, PODCAST_FEEDS.length) }, worker));
  return all;
}

// ─── Curated / Discover (Rollup-style) ───────────────────────────────────────

// A channel's uploads playlist id = its channel id with the 2nd char C->U.
// UCxxxx -> UUxxxx. Lets us fetch recent uploads for 1 quota unit (vs 100 for search).
function uploadsPlaylistId(channelId) {
  if (!channelId || channelId.length < 2 || channelId[1] !== 'C') return null;
  return channelId.slice(0, 1) + 'U' + channelId.slice(2);
}

// Fetch up to `maxResults` recent uploads (snippet only) for one channel's
// uploads playlist. Returns [] on any failure (missing key, bad channel, upstream error).
async function fetchChannelUploads(channelId, maxResults = 5) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const playlistId = uploadsPlaylistId(channelId);
  if (!apiKey || !playlistId) return [];
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId,
      maxResults: String(maxResults),
      key: apiKey,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch {
    return [];
  }
}

// Normalize a YouTube playlistItem snippet (+ details) to the canonical media item.
function normalizeUploadItem(snippet, videoId, details) {
  const det = details[videoId] || {};
  const title = snippet?.title || '';
  const description = snippet?.description || '';
  const text = `${title} ${description}`;
  return {
    id: `yt_${videoId}`,
    type: 'video',
    source: 'youtube',
    title,
    thumbnail: snippet?.thumbnails?.high?.url || snippet?.thumbnails?.default?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    channel: {
      name: snippet?.channelTitle || '',
      avatar: '',
      url: `https://www.youtube.com/channel/${snippet?.channelId}`,
    },
    duration: det.duration || 0,
    publishedAt: snippet?.publishedAt || new Date().toISOString(),
    viewCount: det.viewCount || 0,
    url: `https://www.youtube.com/embed/${videoId}`,
    audioUrl: null,
    tags: extractTokenTags(text),
    description: trimDescription(description),
    category: deriveCategory(text),
  };
}

// Pull recent uploads across the premium channels, enrich with durations/stats,
// normalize to video items, filter shorts + live, dedup, sort newest-first.
// Returns [] if the YouTube API is unavailable (no key / failures).
async function getPremiumVideoItems(limit = 50) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !PREMIUM_CHANNELS.length) return [];

  const settled = await Promise.allSettled(
    PREMIUM_CHANNELS.slice(0, 18).map(ch => fetchChannelUploads(ch.id, 8))
  );

  const raw = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    for (const pi of r.value) {
      const videoId = pi.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      raw.push({ videoId, snippet: pi.snippet, live: pi.snippet?.liveBroadcastContent });
    }
  }
  if (!raw.length) return [];

  // Batch-fetch durations/stats (chunk to 50 per call). ytVideoDetails returns {} on failure.
  const ids = raw.map(r => r.videoId);
  const details = {};
  for (let i = 0; i < ids.length; i += 50) {
    Object.assign(details, await ytVideoDetails(ids.slice(i, i + 50)));
  }

  const videos = raw
    .filter(r => r.live !== 'live')
    .map(r => normalizeUploadItem(r.snippet, r.videoId, details))
    // Filter shorts: explicit #shorts title OR a known sub-3min duration.
    .filter(v => !detectShort(v.title) && !(v.duration > 0 && v.duration < 180));

  const seen = new Set();
  const deduped = videos.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return deduped.slice(0, limit);
}

// Pull recent uploads across the premium channels and keep only the genuine shorts
// (duration > 0 && <= 60s). Normalize to 'short' items, dedup, newest-first, slice.
// Tolerates every failure → []. Cached under 'premium_shorts' (reuses YT_VIDEOS ttl).
async function getPremiumShortItems(limit = 24) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !PREMIUM_CHANNELS.length) return [];

  const cacheKey = 'premium_shorts';
  const cached = getCached(cacheKey, TTL.YT_VIDEOS);
  if (cached && !cached.stale) return cached.data;

  const settled = await Promise.allSettled(
    PREMIUM_CHANNELS.map(ch => fetchChannelUploads(ch.id, 8))
  );

  const raw = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
    for (const pi of r.value) {
      const videoId = pi.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      raw.push({ videoId, snippet: pi.snippet });
    }
  }
  if (!raw.length) return [];

  // Batch-fetch durations/stats (chunk to 50 per call). ytVideoDetails returns {} on failure.
  const ids = raw.map(r => r.videoId);
  const details = {};
  for (let i = 0; i < ids.length; i += 50) {
    Object.assign(details, await ytVideoDetails(ids.slice(i, i + 50)));
  }

  const shorts = raw
    .map(r => normalizeUploadItem(r.snippet, r.videoId, details))
    .filter(v => v.duration > 0 && v.duration <= 60)
    .map(v => ({ ...v, type: 'short' }));

  const seen = new Set();
  const deduped = shorts.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const items = deduped.slice(0, limit);

  if (items.length > 0) setCache(cacheKey, items);
  return items;
}

// Shared curated-podcast fetch used by both podcasts/curated and feed/discover.
// For each show: search/byterm (max 1) -> top feed -> episodes/byfeedid (max 3).
// Tolerates per-show failure; returns [] if Podcast Index is unavailable.
async function getCuratedPodcastItems() {
  const cacheKey = 'podcasts_curated';
  const cached = getCached(cacheKey, TTL.PODCAST);
  if (cached && !cached.stale) return cached.data;

  let headers = null;
  try {
    headers = podcastIndexHeaders();
  } catch {
    // 🪤🪤 This used to `return []`. PODCAST_INDEX_KEY has never been set in
    // any environment, so every podcast surface — the Media Center feed AND the
    // Command Center tab — rendered "no episodes" forever while the endpoint
    // answered 200 in 200ms and looked healthy. Read the publisher feeds
    // instead: no key, same episodes, same audio.
    const rss = await getRssPodcastItems();
    return finishCuratedPodcasts(rss, cacheKey);
  }

  const fetchShow = async (term) => {
    const searchParams = new URLSearchParams({ q: term, max: '1' });
    const searchRes = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byterm?${searchParams}`,
      { headers, signal: AbortSignal.timeout(9000) }
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const feed = (searchData.feeds || [])[0];
    if (!feed || !feed.id) return [];

    const epParams = new URLSearchParams({ id: String(feed.id), max: '4' });
    const epRes = await fetch(
      `https://api.podcastindex.org/api/1.0/episodes/byfeedid?${epParams}`,
      { headers, signal: AbortSignal.timeout(9000) }
    );
    if (!epRes.ok) return [];
    const epData = await epRes.json();
    // The search result carries the show identity; episodes/byfeedid does not
    // always echo the feed title back, so stamp it here.
    return (epData.items || []).map(ep => ({
      ...normalizePodcastEpisode({ ...ep, feedTitle: ep.feedTitle || feed.title, feedImage: ep.feedImage || feed.image }),
      showTitle: feed.title || '',
      showId: feed.id,
    }));
  };

  // 47 shows x 2 upstream calls each cannot go out in one wave — a serverless
  // invocation would time out well before Podcast Index rate-limited us.
  const all = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < CURATED_PODCASTS.length; i += CONCURRENCY) {
    const settled = await Promise.allSettled(
      CURATED_PODCASTS.slice(i, i + CONCURRENCY).map(fetchShow)
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
    }
  }

  // A key that exists but answers with nothing is the same outage as no key.
  if (!all.length) return finishCuratedPodcasts(await getRssPodcastItems(), cacheKey);

  return finishCuratedPodcasts(all, cacheKey);
}

/* Dedupe, newest-first, cap, cache — shared by both lanes so they cannot drift. */
function finishCuratedPodcasts(all, cacheKey) {
  const seen = new Set();
  const deduped = all.filter(ep => {
    if (!ep || !ep.id || seen.has(ep.id)) return false;
    seen.add(ep.id);
    return true;
  });
  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const items = deduped.slice(0, 160);

  if (items.length) setCache(cacheKey, items);
  return items;
}

/**
 * GET /api/media/podcasts/curated
 * Curated premium crypto podcasts (episodes from known shows).
 */
router.get('/podcasts/curated', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const cacheKey = 'podcasts_curated';

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.PODCAST);
    if (cached && !cached.stale) {
      return res.json({
        items: cached.data,
        meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()),
      });
    }
  }

  try {
    // getCuratedPodcastItems is self-caching + never throws.
    const items = await getCuratedPodcastItems();
    // Say which lane actually answered — 'podcast-rss' means we read the
    // publisher feeds directly because Podcast Index had no key or no results.
    res.json({ items, meta: buildMeta((items[0] && items[0].source) || 'podcast-index', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] podcasts/curated error:', err.message);
    res.json({ items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) });
  }
});

// ─── Transcripts (real captions) ─────────────────────────────────────────────
// KEEP IN SYNC with apps/research/api/_lib/handlers/media.js — same parser, same
// field names. A drift here means captions work in dev and silently die in prod.

/* "00:01:02,345" | "00:01:02.345" | "01:02.345" | "62.5" → seconds */
function parseCueTime(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(p => parseFloat(p));
  if (parts.some(p => Number.isNaN(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

const CUE_LINE_RE = /(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?/;

/* SRT and WebVTT share a cue shape; one parser covers both. */
function parseSrtVtt(text) {
  const cues = [];
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const idx = lines.findIndex(l => CUE_LINE_RE.test(l));
    if (idx === -1) continue;
    const [rawStart, rawEnd] = lines[idx].split('-->');
    const s = parseCueTime((rawStart || '').trim());
    const e = parseCueTime((rawEnd || '').trim().split(/\s+/)[0]);
    if (s == null) continue;
    let body = lines.slice(idx + 1).join(' ');
    // VTT voice spans carry the speaker: <v Ryan>…</v>
    let speaker = null;
    const v = body.match(/<v(?:\.\w+)*\s+([^>]+)>/i);
    if (v) speaker = v[1].trim();
    body = body.replace(/<[^>]+>/g, '').trim();
    if (!body) continue;
    // "Ryan: we are so early" — a very common transcript convention
    if (!speaker) {
      const m = body.match(/^([A-Z][\w .'-]{1,28}):\s+(.*)$/);
      if (m) { speaker = m[1].trim(); body = m[2]; }
    }
    cues.push({ s, e: e == null ? s + 4 : e, t: decodeHTMLEntities(body), sp: speaker });
  }
  return cues;
}

/* podcast-namespace JSON: { segments: [{ startTime, endTime, body, speaker }] } */
function parseJsonTranscript(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  const segs = Array.isArray(data) ? data : (data.segments || data.results?.segments || []);
  if (!Array.isArray(segs)) return [];
  const cues = [];
  for (const sg of segs) {
    const s = parseCueTime(sg.startTime ?? sg.start ?? sg.start_time);
    if (s == null) continue;
    const body = String(sg.body ?? sg.text ?? '').trim();
    if (!body) continue;
    const e = parseCueTime(sg.endTime ?? sg.end ?? sg.end_time);
    cues.push({ s, e: e == null ? s + 4 : e, t: body, sp: sg.speaker || null });
  }
  return cues;
}

/* Word-level transcripts are unreadable as a list — merge into caption lines.
   Never merges across a speaker change or a >2.5s silence. */
function mergeCues(cues, { maxChars = 140, maxSpan = 9 } = {}) {
  const out = [];
  for (const c of cues) {
    const last = out[out.length - 1];
    const joinable = last
      && (c.sp || null) === (last.sp || null)
      && c.s - last.e < 2.5
      && last.t.length + c.t.length + 1 <= maxChars
      && c.e - last.s <= maxSpan
      && !/[.!?]["')\]]?$/.test(last.t);
    if (joinable) {
      last.t = `${last.t} ${c.t}`.replace(/\s+/g, ' ');
      last.e = c.e;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

const TRANSCRIPT_MAX_BYTES = 3 * 1024 * 1024;

function parseTranscriptBody(text, contentType, url) {
  const ct = `${contentType || ''} ${url || ''}`.toLowerCase();
  let cues = [];
  const looksJson = ct.includes('json') || /^\s*[[{]/.test(text);
  if (looksJson) cues = parseJsonTranscript(text);
  if (!cues.length && (ct.includes('vtt') || ct.includes('srt') || CUE_LINE_RE.test(text))) {
    cues = parseSrtVtt(text);
  }
  if (cues.length) {
    cues.sort((a, b) => a.s - b.s);
    return { kind: 'timed', cues: mergeCues(cues).slice(0, 6000), paragraphs: [] };
  }
  // No timings anywhere (plain text / HTML transcript). Still worth showing as a
  // readable transcript — it just cannot drive live captions, and says so.
  const plain = decodeHTMLEntities(String(text).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n'))
    .replace(/[ \t]+/g, ' ')
    .split(/\n{1,}/)
    .map(p => p.trim())
    .filter(p => p.length > 2);
  if (!plain.length) return { kind: 'none', cues: [], paragraphs: [] };
  return { kind: 'text', cues: [], paragraphs: plain.slice(0, 800) };
}

/**
 * GET /api/media/podcasts/transcript?url=<transcript url>&type=<mime>
 * Fetches and parses a podcast-namespace transcript into timed caption cues.
 * Server-side because transcript hosts do not send CORS headers.
 */
router.get('/podcasts/transcript', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A http(s) transcript url is required', kind: 'none', cues: [] });
  }
  const cacheKey = `pod_transcript:${url}`;
  const cached = getCached(cacheKey, 24 * 60 * 60 * 1000);
  if (cached && !cached.stale) {
    return res.json({ ...cached.data, meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()) });
  }

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'SpectreAI/1.0', 'Accept': 'application/json, text/vtt, application/x-subrip, text/plain, */*' },
    });
    if (!upstream.ok) throw new Error(`transcript ${upstream.status}`);
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len > TRANSCRIPT_MAX_BYTES) throw new Error('transcript too large');
    const body = await upstream.text();
    if (body.length > TRANSCRIPT_MAX_BYTES) throw new Error('transcript too large');
    const parsed = parseTranscriptBody(body, upstream.headers.get('content-type'), url);
    const payload = { ...parsed, source: url };
    if (parsed.kind !== 'none') setCache(cacheKey, payload);
    res.json({ ...payload, meta: buildMeta('podcast-index', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] podcasts/transcript error:', err.message);
    res.json({ kind: 'none', cues: [], paragraphs: [], source: url, reason: err.message, meta: buildMeta('podcast-index', false, new Date().toISOString()) });
  }
});

/**
 * GET /api/media/podcasts/show?q=<show name>
 * Resolve a show BY NAME to its Podcast Index feed + recent episodes.
 * The curated Spotify shows are keyed by Spotify id, and a Spotify embed only
 * ever exposes its latest episode — so this is how the player offers a show's
 * back catalogue at all.
 */
router.get('/podcasts/show', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'q is required', feed: null, items: [] });
  const max = Math.min(Number(req.query.max) || 24, 40);
  const cacheKey = `pod_show:${q.toLowerCase()}:${max}`;

  const cached = getCached(cacheKey, TTL.PODCAST);
  if (cached && !cached.stale) {
    return res.json({ ...cached.data, meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()) });
  }

  try {
    const headers = podcastIndexHeaders();
    const sp = new URLSearchParams({ q, max: '1' });
    const sr = await fetch(`https://api.podcastindex.org/api/1.0/search/byterm?${sp}`, { headers, signal: AbortSignal.timeout(9000) });
    if (!sr.ok) throw new Error(`search ${sr.status}`);
    const feed = ((await sr.json()).feeds || [])[0];
    if (!feed?.id) return res.json({ feed: null, items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) });

    const ep = new URLSearchParams({ id: String(feed.id), max: String(max) });
    const er = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?${ep}`, { headers, signal: AbortSignal.timeout(9000) });
    const items = er.ok
      ? ((await er.json()).items || []).map(e => normalizePodcastEpisode({ ...e, feedTitle: e.feedTitle || feed.title, feedImage: e.feedImage || feed.image }))
      : [];
    const payload = {
      feed: { id: feed.id, title: feed.title || '', author: feed.author || '', image: feed.image || feed.artwork || '', description: trimDescription(feed.description || '', 320), link: feed.link || '' },
      items,
    };
    if (items.length) setCache(cacheKey, payload);
    res.json({ ...payload, meta: buildMeta('podcast-index', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] podcasts/show error:', err.message);
    res.json({ feed: null, items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) });
  }
});

/**
 * GET /api/media/podcasts/episodes?feedId=<id>
 * Every recent episode of ONE show — powers "more from this show" in the player.
 */
router.get('/podcasts/episodes', async (req, res) => {
  const feedId = req.query.feedId;
  if (!feedId) return res.status(400).json({ error: 'feedId is required', items: [] });
  const max = Math.min(Number(req.query.max) || 20, 40);
  const cacheKey = `pod_episodes:${feedId}:${max}`;

  const cached = getCached(cacheKey, TTL.PODCAST);
  if (cached && !cached.stale) {
    return res.json({ items: cached.data, meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()) });
  }

  try {
    const headers = podcastIndexHeaders();
    const params = new URLSearchParams({ id: String(feedId), max: String(max) });
    const epRes = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?${params}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!epRes.ok) throw new Error(`podcastindex ${epRes.status}`);
    const data = await epRes.json();
    const items = (data.items || []).map(normalizePodcastEpisode);
    if (items.length) setCache(cacheKey, items);
    res.json({ items, meta: buildMeta('podcast-index', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] podcasts/episodes error:', err.message);
    res.json({ items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) });
  }
});

/**
 * GET /api/media/spotify/latest
 * Latest episode (duration + release date) per curated Spotify show, keyed by
 * show id so podcast cards can enrich their metadata. DEGRADES GRACEFULLY: when
 * the Spotify creds aren't set (prod-only env), returns { items: {} } — never throws.
 */
router.get('/spotify/latest', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const cacheKey = 'spotify_latest';

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.SPOTIFY);
    if (cached && !cached.stale) {
      return res.json({
        items: cached.data,
        meta: buildMeta('spotify', true, new Date(Date.now() - cached.age).toISOString()),
      });
    }
  }

  try {
    const settled = await Promise.allSettled(
      APPLE_PODCASTS.map(async ({ spotifyId, appleId }) => {
        const ep = await fetchAppleLatest(appleId);
        return ep ? { id: spotifyId, ep } : null;
      })
    );

    const items = {};
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) items[r.value.id] = r.value.ep;
    }

    setCache(cacheKey, items);
    res.json({ items, meta: buildMeta('spotify', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] spotify/latest error:', err.message);
    res.json({ items: {}, meta: buildMeta('spotify', false, new Date().toISOString()) });
  }
});

/**
 * GET /api/media/ai/synthesize?kind=video|podcast&id=<id>&title=<title>
 * Fast AI synthesis (TL;DR + key points + takeaway) from the content's own
 * description / show-notes (no transcript scraping — YouTube blocks that). Uses
 * Groq. DEGRADES GRACEFULLY: thin source or no key → { summary: null }.
 */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.BRAIN_GROQ_MODEL || 'openai/gpt-oss-120b';
const SYNTH_SYSTEM = `You are Spectre, a crypto market-intelligence engine. Given a video or podcast title, source, and its description / show-notes, produce a fast, useful synthesis for a busy investor. Be concrete and specific to THIS content — no generic filler, no hedging. Never invent facts the text does not support. If the description is thin, summarize only what is actually there. Return JSON only: {"tldr":"one punchy sentence — the core thesis","points":["3 to 5 specific key points, claims, or topics actually covered"],"takeaway":"one sentence — why it matters now (omit forced crypto angles for non-crypto content)"}`;

async function synthFetchVideoMeta(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const params = new URLSearchParams({ part: 'snippet', id: videoId, key: apiKey });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const sn = (await res.json()).items?.[0]?.snippet;
        if (sn) return { title: sn.title || '', source: sn.channelTitle || '', desc: sn.description || '' };
      }
    } catch { /* fall through */ }
  }
  try {
    const page = await (await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    })).text();
    const dm = page.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    const tm = page.match(/"title":"((?:[^"\\]|\\.)*)"/);
    const desc = dm ? JSON.parse(`"${dm[1]}"`) : '';
    const title = tm ? JSON.parse(`"${tm[1]}"`) : '';
    if (desc) return { title, source: '', desc };
  } catch { /* give up */ }
  return null;
}

async function synthFetchPodcastMeta(spotifyId) {
  const entry = APPLE_PODCASTS.find(p => p.spotifyId === spotifyId);
  if (!entry) return null;
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${entry.appleId}&media=podcast&entity=podcastEpisode&limit=3`, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const data = await res.json();
    const ep = (data.results || []).find(r => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode');
    const show = (data.results || []).find(r => r.wrapperType === 'track' || r.kind === 'podcast');
    if (!ep) return null;
    return {
      title: ep.trackName || '',
      source: ep.collectionName || (show && show.collectionName) || '',
      desc: ep.description || ep.shortDescription || (show && show.description) || '',
    };
  } catch { return null; }
}

router.get('/ai/synthesize', async (req, res) => {
  const kind = req.query.kind === 'podcast' ? 'podcast' : 'video';
  const id = (req.query.id || '').trim();
  if (!id) return res.json({ summary: null, meta: buildMeta('ai', false, new Date().toISOString()) });

  const cacheKey = `synth_${kind}_${id}`;
  const cached = getCached(cacheKey, TTL.SYNTH);
  if (cached && !cached.stale) {
    return res.json({ summary: cached.data, meta: buildMeta('ai', true, new Date(Date.now() - cached.age).toISOString()) });
  }

  const meta = kind === 'podcast' ? await synthFetchPodcastMeta(id) : await synthFetchVideoMeta(id);
  const title = (meta && meta.title) || req.query.title || '';
  const desc = ((meta && meta.desc) || '').replace(/\s+/g, ' ').trim();

  if (desc.length < 80) return res.json({ summary: null, reason: 'insufficient-source', meta: buildMeta('ai', false, new Date().toISOString()) });

  try {
    // Resilient multi-provider gateway (groq → cerebras → …) with JSON mode, so
    // a single-provider outage no longer dark-holes synthesis. Degrades to
    // { summary: null } only when every provider fails (r.ok === false).
    const r = await gatewayChat({
      messages: [
        { role: 'system', content: SYNTH_SYSTEM },
        { role: 'user', content: `Type: ${kind}\nTitle: ${title}\nSource: ${(meta && meta.source) || req.query.source || ''}\nDescription / show-notes:\n${desc.slice(0, 4000)}\n\nReturn the synthesis JSON.` },
      ],
      tier: 'smart',
      maxTokens: 600,
      temperature: 0.3,
      json: true,
      timeoutMs: 30000,
    });
    if (!r.ok) return res.json({ summary: null, reason: 'llm-error', meta: buildMeta('ai', false, new Date().toISOString()) });
    const content = r.text;
    let parsed = null;
    try { parsed = JSON.parse(content || ''); } catch { parsed = null; }
    if (!parsed || !parsed.tldr) return res.json({ summary: null, reason: 'llm-empty', meta: buildMeta('ai', false, new Date().toISOString()) });
    const summary = {
      tldr: String(parsed.tldr).trim(),
      points: Array.isArray(parsed.points) ? parsed.points.map(p => String(p).trim()).filter(Boolean).slice(0, 5) : [],
      takeaway: parsed.takeaway ? String(parsed.takeaway).trim() : '',
      title,
    };
    setCache(cacheKey, summary);
    res.json({ summary, meta: buildMeta('ai', false, new Date().toISOString()) });
  } catch (err) {
    console.error('[media] ai/synthesize error:', err.message);
    res.json({ summary: null, reason: 'llm-error', meta: buildMeta('ai', false, new Date().toISOString()) });
  }
});

/**
 * GET /api/media/feed/discover
 * Rollup-style home payload: featured + sectioned rails from curated premium
 * channels (cheap uploads-playlist fetch), curated podcasts, and live.
 * Always returns a valid (possibly sparse) payload — never throws.
 */
router.get('/feed/discover', async (req, res) => {
  const refresh = req.query.refresh === 'true';
  const cacheKey = 'feed_discover';

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.DISCOVER);
    if (cached && !cached.stale) {
      return res.json(cached.data);
    }
  }

  try {
    // Source all three feeds in parallel; each helper degrades to [] on failure.
    const [videosRes, podcastsRes, liveRes] = await Promise.allSettled([
      getPremiumVideoItems(80),
      getCuratedPodcastItems(),
      getPremiumLiveItems(),
    ]);

    const videos = videosRes.status === 'fulfilled' ? videosRes.value : [];
    const podcasts = podcastsRes.status === 'fulfilled' ? podcastsRes.value : [];
    const live = liveRes.status === 'fulfilled' && Array.isArray(liveRes.value) ? liveRes.value : [];

    // Featured: prefer a fresh long-form video (>=10min) with a thumbnail, else freshest with a thumbnail.
    const withThumb = videos.filter(v => v.thumbnail);
    const featured = withThumb.find(v => v.duration >= 600) || withThumb[0] || null;

    const featuredId = featured ? featured.id : null;
    const rest = videos.filter(v => v.id !== featuredId);

    const sections = [
      { id: 'new-releases', title: 'New Releases', layout: 'rail', items: rest.slice(0, 18) },
      { id: 'trending-podcasts', title: 'Trending Podcasts', layout: 'podcast', items: podcasts.slice(0, 14) },
    ];
    if (live.length) {
      sections.push({ id: 'live', title: 'Live Now', layout: 'rail', items: live.slice(0, 10) });
    }
    sections.push({ id: 'all', title: 'All Content', layout: 'grid', items: videos.slice(0, 48) });

    const payload = {
      featured,
      sections,
      meta: buildMeta('mixed', false, new Date().toISOString()),
    };

    // Never poison the 2h cache with an empty payload from a transient upstream
    // failure (e.g. a brief YouTube quota blip) — let the next request retry.
    if (featured || videos.length > 0 || podcasts.length > 0) {
      setCache(cacheKey, payload);
    }
    res.json(payload);
  } catch (err) {
    // Defensive: should never reach here (all sources are allSettled + tolerant).
    console.error('[media] feed/discover error:', err.message);
    res.json({
      featured: null,
      sections: [],
      meta: buildMeta('mixed', false, new Date().toISOString()),
    });
  }
});

// ─── Export ──────────────────────────────────────────────────────────────────

module.exports = router;
