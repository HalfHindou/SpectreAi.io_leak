/**
 * Vercel Serverless – Media Center API
 * Routes based on ?source= and ?type= query params
 * Vercel rewrites map /api/media/* paths to this function
 *
 * Mirrors the logic from packages/server/routes/media.js
 */

import crypto from 'crypto'
import { chat } from '../llm-gateway.js'

// ─── Constants ───────────────────────────────────────────────────────────────

const TTL = {
  YT_VIDEOS:  4 * 60 * 60 * 1000,  // 4 hours
  YT_LIVE:    5 * 60 * 1000,        // 5 minutes
  LIVE_PREMIUM: 3 * 60 * 1000,      // 3 minutes (premium-channel live)
  COMMENTS:  10 * 60 * 1000,        // 10 minutes (video comments)
  TW_LIVE:    2 * 60 * 1000,        // 2 minutes
  TW_CLIPS:   4 * 60 * 60 * 1000,  // 4 hours
  PODCAST:    6 * 60 * 60 * 1000,  // 6 hours
  SPOTIFY:    6 * 60 * 60 * 1000,  // 6 hours (latest-episode metadata)
  CHANNELS:  12 * 60 * 60 * 1000,  // 12 hours
  FOR_YOU:    4 * 60 * 60 * 1000,  // 4 hours
  DISCOVER:   2 * 60 * 60 * 1000,  // 2 hours
  SYNTH:     14 * 24 * 60 * 60 * 1000, // 14 days (AI synthesis — content is static)
  RSS_FEED:   2 * 60 * 60 * 1000,   // 2 hours per channel RSS
}

// Curated Spotify show IDs — latest-episode duration + release date enrich
// podcast cards. DEGRADES GRACEFULLY: no creds → empty items, never throws.
const SPOTIFY_SHOW_IDS = [
  '1P6ZeYd9vbF3hJA2n7qoL5','41TNnXSv5ExcQSzEGLlGhy','4UTePv1CR3APdKOiosR3Iq',
  '1cJrrfGY1SKBIRn5noKSAf','3uMWirMj2hc7IQYEUeBTyT','6JWaXUZF24H0joX1e30GYi',
  '1dYQYB5WxUqmypXXkFuac0','18Pixm6jNMATYXSO6cUnTH','0bn8XQHWGxXULjhp1jRmOJ',
  '0YOEwxAR1uIx1a15QpqE0l','67Kt4UameBIU6KFUl8QJKj',
]

// Latest-episode metadata is sourced from Apple's free, keyless iTunes Lookup
// API (no SPOTIFY_CLIENT_* env needed). Each Spotify show is mapped to its
// Apple Podcasts collection id; the lookup returns the newest episode with a
// real duration + release date. Keyed by spotifyId so the frontend (which
// renders Spotify embeds) consumes it unchanged.
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
]

async function fetchAppleLatest(appleId) {
  const url = `https://itunes.apple.com/lookup?id=${appleId}&media=podcast&entity=podcastEpisode&limit=3`
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) return null
  const data = await res.json()
  const ep = (data.results || []).find(r => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode')
  if (!ep) return null
  return {
    durationSec: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : 0,
    releaseDate: ep.releaseDate || '',
    episodeTitle: ep.trackName || '',
  }
}

const CRYPTO_SEARCH_TERMS = [
  'bitcoin', 'ethereum', 'crypto', 'cryptocurrency', 'defi', 'web3',
  'blockchain', 'altcoin', 'nft', 'trading',
]

const MAJOR_SYMBOLS = new Set([
  'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','MATIC',
  'LINK','UNI','ATOM','FIL','APT','ARB','OP','SUI','SEI','TIA',
  'FET','RNDR','INJ','NEAR','AAVE','MKR','CRV','LDO','PEPE','WIF',
  'BONK','FLOKI','STX','ONDO','IMX','SAND','MANA','AXS','GRT','SNX',
])

// Hardcoded channel seed data (can't read from filesystem in serverless)
const CHANNEL_SEED = {
  youtube: [
    // 🪤 Every id here is RSS-VERIFIED (2026-08-23): the feed returns entries AND
    // its <author><name> is the creator we label it. The previous list failed both
    // tests — 16 of 20 ids returned an EMPTY feed, and two more pointed at the
    // wrong creator ("Whiteboard Crypto" was Bankless's id, "Brian Jung" was Crypto
    // Zombie's). Nothing surfaced it because the keyed search path never reads
    // these ids. Verify a new one against its own feed before adding it:
    //   youtube.com/feeds/videos.xml?channel_id=UC…
    // Zssbecker is deliberately absent: the channel exists, its feed has no videos.
    { id: 'UCqK_GSMbpiV8spgD3ZGloSw', name: 'Coin Bureau', category: 'crypto' },
    { id: 'UCRvqjQPSeaWn-uEx-w0XOIg', name: 'Benjamin Cowen', category: 'crypto' },
    { id: 'UCsYYksPHiGqXHPoHI-fm5sg', name: 'Whiteboard Crypto', category: 'crypto' },
    { id: 'UCVFSzL3VuZKP3cN9IXdLOtw', name: 'Raoul Pal', category: 'crypto' },
    { id: 'UCzVLiG0Ng0z7jm-xX8wMyBQ', name: 'Brian Jung', category: 'crypto' },
    { id: 'UCbLhGKVY-bJPcawebgtNfbw', name: 'Altcoin Daily', category: 'crypto' },
    { id: 'UCCatR7nWbYrkVXdxXb4cGXw', name: 'DataDash', category: 'crypto' },
    { id: 'UCh1ob28ceGdqohUnR7vBACA', name: 'Finematics', category: 'crypto' },
    { id: 'UCAl9Ld79qaZxp9JzEOwd3aA', name: 'Bankless', category: 'crypto' },
    { id: 'UCL0J4MLEdLP0-UyLu0hCktg', name: 'The Defiant', category: 'crypto' },
    { id: 'UCGXWKlq1Oxr3ddEtmKhAkPg', name: 'Real Vision', category: 'crypto' },
    { id: 'UCevXpeL8cNyAnww-NqJ4m2w', name: 'Anthony Pompliano', category: 'crypto' },
    { id: 'UCF31eojFKhWQJviyMICWO2w', name: 'Bitcoin University', category: 'crypto' },
    { id: 'UCIEvlRpHBVFthrF6pZzBEXw', name: 'MoneyZG', category: 'crypto' },
    { id: 'UCtvg5cXLY_tHDJeBoRySBtg', name: 'What Bitcoin Did', category: 'crypto' },
    { id: 'UCCbv0qixG-cyokxEY3kELtg', name: 'TradingLab', category: 'crypto' },
    { id: 'UChzLnWVsl3puKQwc5PoO6Zg', name: 'BTC Sessions', category: 'crypto' },
    { id: 'UCN9Nj4tjXbVTLYWN0EKly_Q', name: 'Crypto Banter', category: 'crypto' },
    { id: 'UCiUnrCUGCJTCC7KjuW493Ww', name: 'Crypto Zombie', category: 'crypto' },
    { id: 'UCl2oCaw8hdR_kbqyqd2klIA', name: 'Lark Davis', category: 'crypto' },
    { id: 'UCGyqEtcGQQtXyUwvcy7Gmyg', name: 'Altcoin Buzz', category: 'crypto' },
    { id: 'UClgJyzwGs-GyaNxUHcLZrkg', name: 'InvestAnswers', category: 'crypto' },
    { id: 'UCnwxzpFzZNtLH8NgTeAROFA', name: 'Krown', category: 'crypto' },
    { id: 'UCKQvGU-qtjEthINeViNbn6A', name: "Alex Becker's Channel", category: 'crypto' },
    { id: 'UCx0R-FZL07GSVFLjql7_cgg', name: 'Wealth Group', category: 'crypto' },
    { id: 'UCzKSvgj7UOIVx45V6853FNA', name: 'Investor Jordan', category: 'crypto' },
    { id: 'UCI7M65p3A-D3P4v5qW8POxQ', name: 'CryptosRUs', category: 'crypto' },
    { id: 'UCMtJYS0PrtiUwlk6zjGDEMA', name: 'EllioTrades', category: 'crypto' },
    { id: 'UC188KLMYLLGqVJZdYq7mYFw', name: 'JRNY Crypto', category: 'crypto' },
    { id: 'UCcrEA_xd9Ldf1C8DIJYdyyA', name: 'VirtualBacon', category: 'crypto' },
    { id: 'UCviqt5aaucA1jP3qFmorZLQ', name: 'Crypto Jebb', category: 'crypto' },
    { id: 'UCd4Ys__EL_gbJrYq6JscrAw', name: 'Cheeky Crypto', category: 'crypto' },
    { id: 'UCc4Rz_T9Sb1w5rqqo9pL1Og', name: 'The Moon', category: 'crypto' },
    { id: 'UCoUcIy0SWXXIhzWgJNdMoFQ', name: 'Crypto Rover', category: 'crypto' },
    { id: 'UCjemQfjaXAzA-95RKoy9n_g', name: 'Discover Crypto', category: 'crypto' },
    { id: 'UCVVX-7tHff75fRAEEEnZiAQ', name: 'Miles Deutscher', category: 'crypto' },
    { id: 'UCia6oYbLKo8fLOguATpACmA', name: 'Blockchain Backer', category: 'crypto' },
    { id: 'UCffNwA5OkxWEmruYFrWJsoQ', name: 'Rekt Capital', category: 'crypto' },
    { id: 'UCjpkwsuHgYx9fBE0ojsJ_-w', name: 'Thinking Crypto', category: 'crypto' },
    { id: 'UC-OTgwOAI7KmP0eDAtqN3Ow', name: 'CoinGecko', category: 'crypto' },
    { id: 'UCV6KDgJskWaEckne5aPA0aQ', name: 'Graham Stephan', category: 'finance' },
    { id: 'UCFCEuCsyWP0YkP3CZ3Mr01Q', name: 'The Plain Bagel', category: 'finance' },
    { id: 'UCGy7SkBjcIAgTiwkXEtPnYg', name: 'Andrei Jikh', category: 'finance' },
    { id: 'UCnMn36GT_H0X-w5_ckLtlgQ', name: 'Financial Education', category: 'finance' },
    { id: 'UCbta0n8i6Rljh0obO7HzG9A', name: 'Joseph Carlson', category: 'stocks' },
    { id: 'UCvJJ_dzjViJCoLf5uKUTwoA', name: 'CNBC', category: 'news' },
    { id: 'UCrM7B7SL_g1edFOnmj-SDKg', name: 'Bloomberg Tech', category: 'news' },
  ],
  twitch: [
    { login: 'coindesk', name: 'CoinDesk' },
    { login: 'cryptocom', name: 'Crypto.com' },
    { login: 'theblock', name: 'The Block' },
    { login: 'blockworks_', name: 'Blockworks' },
    { login: 'crypto_banter', name: 'Crypto Banter' },
    { login: 'realtechreview', name: 'Real Tech Review' },
    { login: 'satoshiclub', name: 'Satoshi Club' },
    { login: 'binance', name: 'Binance' },
    { login: 'aaboronin', name: 'Crypto Trading' },
    { login: 'hustlehard5050', name: 'Hustle Hard Crypto' },
  ],
}

// Curated PREMIUM crypto channels (highest-signal subset of CHANNEL_SEED.youtube).
// Used by feed/discover for a Rollup-style home feed. Resolved to channel ids below.
// Verified channel IDs (resolved + confirmed each returns live uploads via the
// uploads-playlist endpoint, 2026-06-17). NOT sourced from CHANNEL_SEED — that
// seed had ~14 stale/wrong IDs that 404'd on playlistItems.
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
]

// Broader LIVE pool: premium set + reputable crypto channels that livestream
// frequently (the long-form premium channels rarely go live). Verified channel
// ids, 2026-06-17. Still finance-only — keeps the seismic/weather/Twitch junk out.
const LIVE_CHANNELS = [
  ...PREMIUM_CHANNELS,
  { id: 'UC4VPa7EOvObpyCRI4YKRQRw', name: 'Paul Barron Network' },
  { id: 'UCjemQfjaXAzA-95RKoy9n_g', name: 'Discover Crypto' },
  { id: 'UCjpkwsuHgYx9fBE0ojsJ_-w', name: 'Thinking Crypto' },
  { id: 'UCc4Rz_T9Sb1w5rqqo9pL1Og', name: 'The Moon' },
  { id: 'UCd4Ys__EL_gbJrYq6JscrAw', name: 'Cheeky Crypto' },
  { id: 'UCGyqEtcGQQtXyUwvcy7Gmyg', name: 'Altcoin Buzz' },
  { id: 'UClgJyzwGs-GyaNxUHcLZrkg', name: 'InvestAnswers' },
]

// Curated PREMIUM crypto podcasts — Podcast Index search TERMS, not ids, so a
// term that stops matching costs one empty result and never a broken card.
// KEEP IN SYNC with packages/server/routes/media.js.
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
]

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
]

function decodeHTMLEntities(str) {
  if (!str) return ''
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'")
}

// ─── Module-level cache (survives warm instances) ─────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTokenTags(text) {
  if (!text) return []
  const upper = text.toUpperCase()
  return [...MAJOR_SYMBOLS].filter(sym => {
    const re = new RegExp(`\\b${sym}\\b|\\$${sym}\\b`, 'i')
    return re.test(upper)
  })
}

function isShort(item) {
  const title = (item.snippet?.title || '').toLowerCase()
  const tags  = (item.snippet?.tags || []).join(' ').toLowerCase()
  const duration = item._durationSeconds || 0
  return (/#shorts?\b/.test(title) || /#shorts?\b/.test(tags)) && (duration === 0 || duration < 180)
}

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
]

function deriveCategory(text) {
  if (!text) return 'Markets'
  for (const [label, re] of CATEGORY_RULES) {
    if (re.test(text)) return label
  }
  return 'Markets'
}

// Trim a description/snippet to a short thesis subtitle (<=180 chars, single line).
function trimDescription(text, max = 180) {
  if (!text) return ''
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1).trimEnd() + '…'
}

function parseDuration(iso) {
  if (!iso) return 0
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0)
}

function buildMeta(source, cached, lastRefreshed, nextPage = null) {
  return { source, cached, lastRefreshed, nextPage }
}

// ─── Twitch OAuth ─────────────────────────────────────────────────────────────

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

// ─── Spotify OAuth (client-credentials) ──────────────────────────────────────

let spotifyToken = null
let spotifyTokenExp = 0

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('spotify-not-configured')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Spotify OAuth failed: ${res.status}`)
  const data = await res.json()
  spotifyToken = data.access_token
  spotifyTokenExp = Date.now() + (data.expires_in - 60) * 1000
  return spotifyToken
}

// ─── Podcast Index HMAC Auth ──────────────────────────────────────────────────

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

// ─── YouTube Helpers ──────────────────────────────────────────────────────────

async function ytSearch(query, { maxResults = 25, pageToken = null, eventType = null, videoDuration = null } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YouTube API key not configured')

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(maxResults),
    order: 'date',
    key: apiKey,
  })
  if (pageToken) params.set('pageToken', pageToken)
  if (eventType) params.set('eventType', eventType)
  if (videoDuration) params.set('videoDuration', videoDuration)

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`YouTube search failed: ${res.status} ${errBody}`)
  }
  return res.json()
}

async function ytVideoDetails(ids) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || !ids.length) return {}
  const params = new URLSearchParams({
    part: 'contentDetails,statistics',
    id: ids.join(','),
    key: apiKey,
  })
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
  if (!res.ok) return {}
  const data = await res.json()
  const map = {}
  for (const item of (data.items || [])) {
    map[item.id] = {
      duration: parseDuration(item.contentDetails?.duration),
      viewCount: parseInt(item.statistics?.viewCount || '0', 10),
    }
  }
  return map
}

// Fetch live-stream details for a set of video ids. For each returned video build
// a map keyed by id: { liveState, concurrent, startedAt, viewCount, snippet }.
// Returns {} on any failure (missing key, no ids, upstream error) — never throws.
async function ytVideoLiveDetails(ids) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || !ids.length) return {}
  const map = {}
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      const params = new URLSearchParams({
        part: 'snippet,liveStreamingDetails,statistics',
        id: chunk.join(','),
        key: apiKey,
      })
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
      if (!res.ok) continue
      const data = await res.json()
      for (const item of (data.items || [])) {
        map[item.id] = {
          liveState: item.snippet?.liveBroadcastContent,
          concurrent: parseInt(item.liveStreamingDetails?.concurrentViewers || '0', 10),
          startedAt: item.liveStreamingDetails?.actualStartTime,
          viewCount: parseInt(item.statistics?.viewCount || '0', 10),
          snippet: item.snippet,
        }
      }
    } catch {
      // tolerate — chunk just contributes nothing
    }
  }
  return map
}

function normalizeYtItem(item, details = {}, type = 'video') {
  const videoId = item.id?.videoId || item.id
  const det = details[videoId] || {}
  const title = item.snippet?.title || ''
  const description = item.snippet?.description || ''
  const text = `${title} ${description} ${(item.snippet?.tags || []).join(' ')}`
  return {
    id: `yt_${videoId}`,
    type,
    source: 'youtube',
    title,
    thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || '',
    channel: {
      name: item.snippet?.channelTitle || '',
      avatar: '',
      url: `https://www.youtube.com/channel/${item.snippet?.channelId}`,
    },
    duration: det.duration || 0,
    publishedAt: item.snippet?.publishedAt || new Date().toISOString(),
    viewCount: det.viewCount || 0,
    url: `https://www.youtube.com/embed/${videoId}`,
    audioUrl: null,
    tags: extractTokenTags(text),
    description: trimDescription(description),
    category: deriveCategory(`${title} ${description}`),
  }
}

// ─── YouTube Route Handlers ───────────────────────────────────────────────────

// ─── YouTube channel RSS (keyless) ───────────────────────────────────────────
// 🪤🪤 The dev server has served YouTube from these feeds since the Media Center
// shipped; prod never got the lane and calls the Data API instead, which throws
// without YOUTUBE_API_KEY — a key that has never been set in any environment.
// So every YouTube surface answered 500 in prod while working fine locally, and
// the curated channel list above was dead weight. youtube.com publishes a free
// per-channel Atom feed with the newest 15 uploads: no key, no quota, no cap.
// KEEP IN SYNC with packages/server/routes/media.js.

/* A title that reads like a Short. RSS carries no duration or aspect ratio, so
   this is the only signal available before the video is opened. */
function detectShort(title) {
  if (!title) return false
  if (/#shorts?\b/i.test(title)) return true
  const emoji = (title.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length
  if (title.length <= 40 && emoji >= 2) return true
  if (title.length <= 35) {
    const upper = title.replace(/[^a-zA-Z]/g, '')
    if (upper.length > 5 && upper === upper.toUpperCase()) return true
  }
  return false
}

/* General-news channels (CNBC, Bloomberg) publish far more than markets — keep
   only the videos that are actually about money. */
const FINANCE_KEYWORDS_RE = /\bcrypto|bitcoin|btc|ethereum|eth|blockchain|defi|web3|nft|market|stock|invest|economy|finance|fed\b|inflation|tariff|trade|recession|earnings|revenue|profit|gdp|treasury|dividend|rally|crash|bull|bear|portfolio|wallet|exchange|mining|token|coin|stablecoin|yield|bonds?|equity|nasdaq|s&p|dow\s*jones|wall\s*street|bank|central\s*bank|monetary|fiscal|rate\s*hike|rate\s*cut|oil|gold|commodity|forex|ipo|merger|acquisition|sec\b|regulation|senate|congress|funding|startup|vc\b|venture|valuation|billion|trillion|million\b/i

function parseYouTubeRssEntries(xml, channelName, channelId, category) {
  const entries = []
  if (!channelName) {
    const feedTitle = xml.match(/<feed[^>]*>[\s\S]*?<title>([^<]+)<\/title>/)
    if (feedTitle) channelName = decodeHTMLEntities(feedTitle[1])
  }
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let m
  while ((m = entryRe.exec(xml)) !== null) {
    const entry = m[1]
    const videoId = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1]
    const title = (entry.match(/<title>([^<]+)<\/title>/) || [])[1]
    if (!videoId || !title) continue
    const published = (entry.match(/<published>([^<]+)<\/published>/) || [])[1]
    const thumbnail = (entry.match(/<media:thumbnail url="([^"]+)"/) || [])[1]
    const views = parseInt((entry.match(/<media:statistics views="(\d+)"/) || [])[1] || '0', 10)
    const author = (entry.match(/<author>\s*<name>([^<]+)<\/name>/) || [])[1]
    const rawDesc = (entry.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1]
    const t = decodeHTMLEntities(title)
    const d = decodeHTMLEntities(rawDesc || '')
    entries.push({
      id: `yt_${videoId}`,
      videoId,
      type: 'video',
      source: 'youtube',
      title: t,
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      channel: {
        name: decodeHTMLEntities(author || channelName || ''),
        avatar: '',
        url: `https://www.youtube.com/channel/${channelId}`,
      },
      duration: 0, // RSS carries none; enriched below when a key exists
      publishedAt: published || new Date().toISOString(),
      viewCount: views,
      url: `https://www.youtube.com/embed/${videoId}`,
      audioUrl: null,
      tags: extractTokenTags(`${t} ${d} ${channelName || ''}`),
      description: trimDescription(d),
      primaryCategory: deriveCategory(`${t} ${d}`),
      category,
      _isShort: detectShort(t),
    })
  }
  return entries
}

async function fetchChannelRSS(channelId, channelName = '', category = 'crypto') {
  const cacheKey = `rss:${channelId}`
  const cached = getCached(cacheKey, TTL.RSS_FEED)
  if (cached && !cached.stale) return cached.data
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      { headers: { 'User-Agent': 'SpectreAI/1.0 (+https://app.spectreai.io)' }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return []
    const entries = parseYouTubeRssEntries(await res.text(), channelName, channelId, category)
    if (entries.length) setCache(cacheKey, entries)
    return entries
  } catch {
    return [] // one dead channel must never take the feed down
  }
}

/* The whole curated list, newest-first, shorts split out. Cached as one blob so
   paging never refetches. */
async function getYouTubeRssItems(kind = 'videos') {
  const cacheKey = 'yt_rss_all'
  let all = null
  const cached = getCached(cacheKey, TTL.YT_VIDEOS)
  if (cached && !cached.stale) all = cached.data

  if (!all) {
    const channels = CHANNEL_SEED.youtube || []
    const collected = []
    const POOL = 12
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const ch = channels[cursor++]
        if (!ch) return
        const eps = await fetchChannelRSS(ch.id, ch.name, ch.category || 'crypto')
        if (eps.length) collected.push(...eps)
      }
    }
    await Promise.all(Array.from({ length: Math.min(POOL, channels.length) }, worker))
    all = collected
    if (all.length) setCache(cacheKey, all)
  }

  const priority = { crypto: 0, finance: 1, stocks: 1, news: 2 }
  return all
    .filter(e => (kind === 'shorts' ? e._isShort : !e._isShort))
    .filter(e => (e.category === 'news' ? FINANCE_KEYWORDS_RE.test(e.title) : true))
    .sort((a, b) => {
      const pa = priority[a.category] ?? 1
      const pb = priority[b.category] ?? 1
      if (pa !== pb) return pa - pb
      return new Date(b.publishedAt) - new Date(a.publishedAt)
    })
    .map(({ _isShort, videoId, category, primaryCategory, ...rest }) => ({ ...rest, category: primaryCategory }))
}

/* Page the blob and, only if a key happens to exist, fill in real durations for
   the page being returned. Never required. */
async function serveYouTubeRss(query, kind) {
  const perPage = 24
  const page = Math.max(1, parseInt(query.pageToken || query.page || '1', 10) || 1)
  const all = await getYouTubeRssItems(kind)
  const start = (page - 1) * perPage
  const slice = all.slice(start, start + perPage)
  const nextPage = start + perPage < all.length ? String(page + 1) : null

  if (process.env.YOUTUBE_API_KEY && slice.length) {
    try {
      const details = await ytVideoDetails(slice.map(v => v.id.replace(/^yt_/, '')))
      for (const v of slice) {
        const det = details[v.id.replace(/^yt_/, '')]
        if (det) { v.duration = det.duration || 0; v.viewCount = det.viewCount || v.viewCount }
      }
    } catch { /* enrichment is optional by design */ }
  }

  return { items: slice, meta: buildMeta('youtube-rss', false, new Date().toISOString(), nextPage) }
}

async function handleYouTubeVideos(query) {
  const q = query.q || CRYPTO_SEARCH_TERMS[0]
  const pageToken = query.pageToken || query.page || null
  const refresh = query.refresh === 'true'
  const cacheKey = `yt_videos:${q}:${pageToken || '1'}`

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.YT_VIDEOS)
    if (cached && !cached.stale) {
      return {
        items: cached.data.items,
        meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString(), cached.data.nextPage),
      }
    }
  }
  // No key configured is the NORMAL case here, not an error path.
  if (!process.env.YOUTUBE_API_KEY) return serveYouTubeRss(query, 'videos')

  const searchRes = await ytSearch(`${q} crypto`, { maxResults: 25, pageToken })
  const items = searchRes.items || []
  const ids = items.map(i => i.id?.videoId).filter(Boolean)
  const details = await ytVideoDetails(ids)

  const videos = items
    .filter(i => i.snippet?.liveBroadcastContent !== 'live')
    .map(i => {
      const det = details[i.id?.videoId] || {}
      i._durationSeconds = det.duration || 0
      return i
    })
    .filter(i => !isShort(i))
    .map(i => normalizeYtItem(i, details, 'video'))

  const payload = { items: videos, nextPage: searchRes.nextPageToken || null }
  setCache(cacheKey, payload)
  return {
    items: videos,
    meta: buildMeta('youtube', false, new Date().toISOString(), payload.nextPage),
  }
}

async function handleYouTubeShorts(query) {
  const q = query.q || CRYPTO_SEARCH_TERMS[0]
  const pageToken = query.pageToken || query.page || null
  const refresh = query.refresh === 'true'
  const cacheKey = `yt_shorts:${q}:${pageToken || '1'}`

  // A "real" user search has an explicit q that isn't one of the default crypto seeds.
  const rawQ = (query.q || '').trim().toLowerCase()
  const isDefaultSeed = !rawQ || rawQ === 'crypto' || rawQ === 'bitcoin'

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.YT_VIDEOS)
    if (cached && !cached.stale) {
      return {
        items: cached.data.items,
        meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString(), cached.data.nextPage),
      }
    }
  }
  // Same as videos: with no key, the curated feeds are the source of truth.
  if (!process.env.YOUTUBE_API_KEY) return serveYouTubeRss(query, 'shorts')

  const searchRes = await ytSearch(`${q} crypto #shorts`, { maxResults: 25, pageToken, videoDuration: 'short' })
  const items = searchRes.items || []
  const ids = items.map(i => i.id?.videoId).filter(Boolean)
  const details = await ytVideoDetails(ids)

  const searchShorts = items
    .map(i => {
      const det = details[i.id?.videoId] || {}
      i._durationSeconds = det.duration || 0
      return i
    })
    .filter(i => isShort(i) || (i._durationSeconds > 0 && i._durationSeconds < 180))
    .map(i => normalizeYtItem(i, details, 'short'))

  // No real query → premium-channel shorts FIRST (quality), then top up with the
  // search shorts for volume, deduped by id. A real user search keeps search-only.
  let shorts = searchShorts
  if (isDefaultSeed) {
    let premium = []
    try {
      premium = await getPremiumShortItems(24)
    } catch {
      premium = []
    }
    const seen = new Set(premium.map(s => s.id))
    const topUp = searchShorts.filter(s => {
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
    shorts = [...premium, ...topUp]
  }

  const payload = { items: shorts, nextPage: searchRes.nextPageToken || null }
  setCache(cacheKey, payload)
  return {
    items: shorts,
    meta: buildMeta('youtube', false, new Date().toISOString(), payload.nextPage),
  }
}

// Source live streams from the curated premium channels (NOT a junk keyword search).
// Pull each channel's most-recent uploads, probe their live-stream details, keep only
// those currently live, normalize to media items. Tolerates every failure → [].
async function getPremiumLiveItems(refresh = false) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || !LIVE_CHANNELS.length) return []

  const cacheKey = 'premium_live'
  if (!refresh) {
    const cached = getCached(cacheKey, TTL.LIVE_PREMIUM)
    if (cached && !cached.stale) return cached.data
  }

  // Collect candidate videoIds from the latest uploads of each live channel.
  const settled = await Promise.allSettled(
    LIVE_CHANNELS.map(ch => fetchChannelUploads(ch.id, 3)),
  )
  const ids = []
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue
    for (const pi of r.value) {
      const videoId = pi.snippet?.resourceId?.videoId
      if (videoId) ids.push(videoId)
    }
  }
  if (!ids.length) {
    setCache(cacheKey, [])
    return []
  }

  let liveMap
  try {
    liveMap = await ytVideoLiveDetails(ids)
  } catch {
    return []
  }

  const items = []
  for (const id of ids) {
    const det = liveMap[id]
    if (!det || det.liveState !== 'live') continue
    const snippet = det.snippet || {}
    const title = snippet.title || ''
    const description = snippet.description || ''
    const text = `${title} ${description} ${(snippet.tags || []).join(' ')}`
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
    })
  }

  // Dedup by id, sort by viewCount (concurrent) desc.
  const seen = new Set()
  const deduped = items.filter(it => {
    if (seen.has(it.id)) return false
    seen.add(it.id)
    return true
  })
  deduped.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))

  setCache(cacheKey, deduped)
  return deduped
}

async function handleYouTubeLive(query) {
  return {
    items: await getPremiumLiveItems(query.refresh === 'true'),
    meta: buildMeta('youtube', false, new Date().toISOString()),
  }
}

// ─── Twitch Normalizers ───────────────────────────────────────────────────────

function normalizeTwitchStream(stream) {
  const text = `${stream.title || ''} ${(stream.tags || []).join(' ')}`
  const thumb = (stream.thumbnail_url || '').replace('{width}', '320').replace('{height}', '180')
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
  }
}

function normalizeTwitchClip(clip) {
  const text = `${clip.title || ''}`
  return {
    id: `tw_clip_${clip.id}`,
    type: 'clip',
    source: 'twitch',
    title: clip.title || '',
    thumbnail: clip.thumbnail_url || '',
    channel: {
      name: clip.broadcaster_name || '',
      avatar: '',
      url: `https://www.twitch.tv/${clip.broadcaster_name?.toLowerCase()}`,
    },
    duration: Math.round(clip.duration || 0),
    publishedAt: clip.created_at || new Date().toISOString(),
    viewCount: clip.view_count || 0,
    url: clip.embed_url || `https://clips.twitch.tv/${clip.id}`,
    audioUrl: null,
    tags: extractTokenTags(text),
  }
}

// ─── Twitch Route Handlers ────────────────────────────────────────────────────

// Twitch dropped as a live source. The only crypto-adjacent Twitch category was
// game_id 509670 ("Science & Technology"), which returns junk (seismic monitors,
// weather channels, 3D printing). No usable crypto category exists → return [].
// Function kept so the route + switch case stay valid. handleTwitchClips is unaffected.
// Reuses getTwitchToken() defined above. Twitch's real "Crypto" category
// (NOT 509670 = Science & Technology, which returned junk).
const TWITCH_CRYPTO_GAME_ID = '499634'

async function handleTwitchLive(query) {
  const cacheKey = 'twitch_live'
  const cached = getCached(cacheKey, TTL.TW_LIVE)
  if (cached && !cached.stale) {
    return { items: cached.data, meta: buildMeta('twitch', true, new Date(Date.now() - cached.age).toISOString()) }
  }
  let token
  try { token = await getTwitchToken() } catch { return { items: [], meta: buildMeta('twitch', false, new Date().toISOString()) } }
  try {
    const res = await fetch(`https://api.twitch.tv/helix/streams?game_id=${TWITCH_CRYPTO_GAME_ID}&first=40`, {
      headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { items: [], meta: buildMeta('twitch', false, new Date().toISOString()) }
    const data = await res.json()
    const items = (data.data || [])
      .filter(s => s.language === 'en' && (s.viewer_count || 0) >= 3)
      .slice(0, 16)
      .map(normalizeTwitchStream)
    setCache(cacheKey, items)
    return { items, meta: buildMeta('twitch', false, new Date().toISOString()) }
  } catch {
    return { items: [], meta: buildMeta('twitch', false, new Date().toISOString()) }
  }
}

async function handleTwitchClips(query) {
  const period = query.period || 'week'
  const refresh = query.refresh === 'true'
  const cacheKey = `tw_clips:${period}`

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.TW_CLIPS)
    if (cached && !cached.stale) {
      return {
        items: cached.data,
        meta: buildMeta('twitch', true, new Date(Date.now() - cached.age).toISOString()),
      }
    }
  }

  const clientId = process.env.TWITCH_CLIENT_ID
  if (!clientId) throw new Error('Twitch credentials not configured')
  const token = await getTwitchToken()

  const now = new Date()
  const periodDays = { day: 1, week: 7, month: 30 }
  const days = periodDays[period] || 7
  const startedAt = new Date(now - days * 24 * 60 * 60 * 1000).toISOString()

  const params = new URLSearchParams({
    game_id: '509670',
    first: '20',
    started_at: startedAt,
  })

  const clipsRes = await fetch(`https://api.twitch.tv/helix/clips?${params}`, {
    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
  })
  if (!clipsRes.ok) throw new Error(`Twitch clips failed: ${clipsRes.status}`)

  const data = await clipsRes.json()
  const items = (data.data || []).map(normalizeTwitchClip)

  setCache(cacheKey, items)
  return { items, meta: buildMeta('twitch', false, new Date().toISOString()) }
}

// ─── Podcast Normalizers ──────────────────────────────────────────────────────

function normalizePodcastFeed(feed) {
  return {
    id: `pod_${feed.id}`,
    type: 'podcast',
    source: 'podcast-index',
    title: feed.title || feed.podcastName || '',
    thumbnail: feed.image || feed.artwork || '',
    channel: {
      name: feed.author || feed.ownerName || '',
      avatar: feed.image || '',
      url: feed.link || feed.url || '',
    },
    duration: 0,
    publishedAt: feed.lastUpdateTime
      ? new Date(feed.lastUpdateTime * 1000).toISOString()
      : new Date().toISOString(),
    viewCount: 0,
    url: feed.url || '',
    audioUrl: null,
    tags: extractTokenTags(`${feed.title || ''} ${feed.description || ''}`),
    feedId: feed.id,
  }
}

// The podcast namespace ships <podcast:transcript> per episode. Podcast Index
// exposes it as `transcripts[]` (newer) or a bare `transcriptUrl` (older). This
// is the ONLY real caption source we have — where a show publishes none, the
// player says so rather than inventing lines.
function pickTranscripts(ep) {
  const out = []
  const seen = new Set()
  const push = (url, type) => {
    if (!url || typeof url !== 'string' || seen.has(url)) return
    if (!/^https?:\/\//i.test(url)) return
    seen.add(url)
    out.push({ url, type: (type || '').toLowerCase() })
  }
  if (Array.isArray(ep.transcripts)) {
    for (const tr of ep.transcripts) push(tr?.url, tr?.type)
  }
  push(ep.transcriptUrl, '')
  const rank = (t) => (
    t.includes('json') ? 0 : t.includes('vtt') ? 1 : t.includes('srt') ? 2 : t.includes('html') ? 4 : 3
  )
  return out.sort((a, b) => rank(a.type) - rank(b.type)).slice(0, 4)
}

function normalizePodcastEpisode(ep) {
  const title = ep.title || ''
  const description = ep.description || ''
  const transcripts = pickTranscripts(ep)
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
  }
}


// ─── Keyless RSS lane ─────────────────────────────────────────────────────────
// Podcast Index is an index OF these feeds, so reading the publisher feed
// directly loses nothing: same enclosure URL, same duration, same
// <podcast:transcript>. It also spreads the load over 40 hosts instead of one
// rate-limited API. KEEP IN SYNC with packages/server/routes/media.js.

const stripCData = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

function xmlTagText(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'))
  return m ? decodeHTMLEntities(stripCData(m[1])).trim() : ''
}

function xmlAttr(xml, tag, name) {
  const m = xml.match(new RegExp('<' + tag + '\\b[^>]*\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']', 'i'))
  return m ? decodeHTMLEntities(m[1]).trim() : ''
}

/* "1:02:03" | "12:34" | "4952" → seconds. Feeds use all three. */
function parseItunesDuration(raw) {
  if (!raw) return 0
  const s = String(raw).trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s))
  const parts = s.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
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
  })
  if (!res.ok || !res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let xml = ''
  let bytes = 0
  let items = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      const chunk = decoder.decode(value, { stream: true })
      items += (chunk.match(/<\/item>/gi) || []).length
      xml += chunk
      if (items >= maxItems || bytes >= maxBytes) break
    }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
  return xml
}

/* One <item> → the same shape normalizePodcastEpisode returns, so the player,
   the transcript route and every card consume it unchanged. */
function normalizeRssEpisode(block, show, feed) {
  const audioUrl = xmlAttr(block, 'enclosure', 'url')
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) return null
  const title = xmlTagText(block, 'title')
  if (!title) return null

  const description = xmlTagText(block, 'description') || xmlTagText(block, 'itunes:summary') || ''
  const published = xmlTagText(block, 'pubDate')
  const when = published ? new Date(published) : null

  const transcripts = []
  const seen = new Set()
  const trRe = /<podcast:transcript\b[^>]*>/gi
  let m
  while ((m = trRe.exec(block))) {
    const u = (m[0].match(/\burl\s*=\s*["']([^"']+)["']/i) || [])[1]
    if (!u) continue
    const url = decodeHTMLEntities(u).trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    const type = ((m[0].match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || '').toLowerCase()
    transcripts.push({ url, type })
  }
  const rank = (t) => (t.includes('json') ? 0 : t.includes('vtt') ? 1 : t.includes('srt') ? 2 : t.includes('html') ? 4 : 3)
  transcripts.sort((a, b) => rank(a.type) - rank(b.type))

  // The GUID is the feed's own stable episode key; hashing keeps the id short
  // and URL-safe while staying stable across refreshes (resume positions and
  // the "continue listening" rail are keyed on it).
  const guid = xmlTagText(block, 'guid') || audioUrl
  const id = crypto.createHash('sha1').update(`${show.id}:${guid}`).digest('hex').slice(0, 16)
  const plain = decodeHTMLEntities(stripCData(description).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

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
  }
}

async function fetchShowFromRss(show) {
  const xml = await fetchFeedHead(show.feedUrl)
  if (!xml) return []
  const cut = xml.search(/<item[\s>]/i)
  const head = cut > 0 ? xml.slice(0, cut) : xml
  const feed = {
    image: xmlAttr(head, 'itunes:image', 'href') || xmlTagText(head, 'url') || '',
    link: xmlTagText(head, 'link') || '',
  }
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []
  const out = []
  for (const b of blocks) {
    const ep = normalizeRssEpisode(b, show, feed)
    if (ep) out.push(ep)
  }
  return out
}

/* All 40 shows through a real worker POOL, not lockstep Promise.allSettled
   waves. 🪤 With waves, one 9s host stalls the other seven slots for the whole
   wave — measured 24s wall on a bad run against 4s on a good one, and this
   function has a 30s ceiling. A pool lets a fast feed's slot start the next
   show immediately, so wall time tracks the AVERAGE feed, not the worst one in
   each of five waves. Per-feed failure costs that show and nothing else. */
async function getRssPodcastItems() {
  const all = []
  const POOL = 12
  let cursor = 0
  const deadline = Date.now() + 20000

  const worker = async () => {
    for (;;) {
      const show = PODCAST_FEEDS[cursor++]
      if (!show) return
      // Whatever we have when the budget runs out beats a function timeout,
      // which would return NOTHING and cache nothing.
      if (Date.now() > deadline) return
      try {
        const eps = await fetchShowFromRss(show)
        if (eps.length) all.push(...eps)
      } catch (err) {
        console.warn(`[media] rss feed failed (${show.name}):`, err.message)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL, PODCAST_FEEDS.length) }, worker))
  return all
}

// ─── Podcast Route Handlers ───────────────────────────────────────────────────

async function handlePodcastSearch(query) {
  const q = query.q || 'crypto'
  const refresh = query.refresh === 'true'
  const cacheKey = `pod_search:${q}`

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.PODCAST)
    if (cached && !cached.stale) {
      return {
        items: cached.data,
        meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()),
      }
    }
  }

  const headers = podcastIndexHeaders()
  const params = new URLSearchParams({ q, max: '25' })
  const apiRes = await fetch(`https://api.podcastindex.org/api/1.0/search/byterm?${params}`, { headers })
  if (!apiRes.ok) throw new Error(`Podcast Index search failed: ${apiRes.status}`)
  const data = await apiRes.json()
  const items = (data.feeds || []).map(normalizePodcastFeed)

  setCache(cacheKey, items)
  return { items, meta: buildMeta('podcast-index', false, new Date().toISOString()) }
}

async function handlePodcastEpisodes(query) {
  const feedId = query.feedId
  if (!feedId) return { items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) }

  const refresh = query.refresh === 'true'
  const max = Math.min(Number(query.max) || 20, 40)
  const cacheKey = `pod_episodes:${feedId}:${max}`

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.PODCAST)
    if (cached && !cached.stale) {
      return {
        items: cached.data,
        meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()),
      }
    }
  }

  // Degrades to an empty rail rather than a 500 — "more from this show" is a
  // nice-to-have inside the player, never the reason playback fails.
  try {
    const headers = podcastIndexHeaders()
    const params = new URLSearchParams({ id: String(feedId), max: String(max) })
    const apiRes = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?${params}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    })
    if (!apiRes.ok) throw new Error(`Podcast Index episodes failed: ${apiRes.status}`)
    const data = await apiRes.json()
    const items = (data.items || []).map(normalizePodcastEpisode)
    if (items.length) setCache(cacheKey, items)
    return { items, meta: buildMeta('podcast-index', false, new Date().toISOString()) }
  } catch (err) {
    console.error('[media] podcasts/episodes error:', err.message)
    return { items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) }
  }
}

// ─── Channel Route Handlers ───────────────────────────────────────────────────

async function fetchYouTubeChannels(channelIds) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || !channelIds.length) {
    return channelIds.map(id => ({
      id: `yt_ch_${id}`,
      source: 'youtube',
      name: id,
      description: '',
      avatar: '',
      banner: null,
      subscriberCount: 0,
      videoCount: 0,
      lastUpload: null,
      isLive: false,
      url: `https://www.youtube.com/channel/${id}`,
    }))
  }

  const batches = []
  for (let i = 0; i < channelIds.length; i += 50) {
    batches.push(channelIds.slice(i, i + 50))
  }

  const results = []
  for (const batch of batches) {
    const params = new URLSearchParams({
      part: 'snippet,statistics,brandingSettings,contentDetails',
      id: batch.join(','),
      key: apiKey,
    })
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`)
      if (!res.ok) continue
      const data = await res.json()
      for (const ch of (data.items || [])) {
        results.push({
          id: `yt_ch_${ch.id}`,
          source: 'youtube',
          name: ch.snippet?.title || ch.id,
          description: ch.snippet?.description || '',
          avatar: ch.snippet?.thumbnails?.default?.url || '',
          banner: ch.brandingSettings?.image?.bannerExternalUrl || null,
          subscriberCount: parseInt(ch.statistics?.subscriberCount || '0', 10),
          videoCount: parseInt(ch.statistics?.videoCount || '0', 10),
          lastUpload: null,
          isLive: false,
          url: `https://www.youtube.com/channel/${ch.id}`,
        })
      }
    } catch (err) {
      console.error('[media] YouTube channels batch error:', err.message)
    }
  }
  return results
}

async function fetchTwitchChannels(logins) {
  const clientId = process.env.TWITCH_CLIENT_ID
  if (!clientId || !logins.length) {
    return logins.map(login => ({
      id: `tw_ch_${login}`,
      source: 'twitch',
      name: login,
      description: '',
      avatar: '',
      banner: null,
      subscriberCount: 0,
      videoCount: 0,
      lastUpload: null,
      isLive: false,
      url: `https://www.twitch.tv/${login}`,
    }))
  }

  try {
    const token = await getTwitchToken()
    const loginParams = logins.map(l => `login=${encodeURIComponent(l)}`).join('&')

    const [usersRes, streamsRes] = await Promise.allSettled([
      fetch(`https://api.twitch.tv/helix/users?${loginParams}`, {
        headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
      }),
      fetch(`https://api.twitch.tv/helix/streams?${loginParams}`, {
        headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
      }),
    ])

    const liveLogins = new Set()
    if (streamsRes.status === 'fulfilled' && streamsRes.value.ok) {
      const data = await streamsRes.value.json()
      for (const s of (data.data || [])) liveLogins.add(s.user_login.toLowerCase())
    }

    if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
      const data = await usersRes.value.json()
      return (data.data || []).map(u => ({
        id: `tw_ch_${u.id}`,
        source: 'twitch',
        name: u.display_name || u.login,
        description: u.description || '',
        avatar: u.profile_image_url || '',
        banner: u.offline_image_url || null,
        subscriberCount: 0,
        videoCount: 0,
        lastUpload: null,
        isLive: liveLogins.has(u.login.toLowerCase()),
        url: `https://www.twitch.tv/${u.login}`,
      }))
    }
  } catch (err) {
    console.error('[media] Twitch channels error:', err.message)
  }

  return logins.map(login => ({
    id: `tw_ch_${login}`,
    source: 'twitch',
    name: login,
    description: '',
    avatar: '',
    banner: null,
    subscriberCount: 0,
    videoCount: 0,
    lastUpload: null,
    isLive: false,
    url: `https://www.twitch.tv/${login}`,
  }))
}

async function handleChannels(type, query) {
  const refresh = query.refresh === 'true'

  if (type === 'youtube') {
    const cacheKey = 'channels_youtube'
    if (!refresh) {
      const cached = getCached(cacheKey, TTL.CHANNELS)
      if (cached && !cached.stale) {
        return { items: cached.data, meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString()) }
      }
    }
    const ytIds = CHANNEL_SEED.youtube.map(c => c.id)
    const items = await fetchYouTubeChannels(ytIds)
    setCache(cacheKey, items)
    return { items, meta: buildMeta('youtube', false, new Date().toISOString()) }
  }

  if (type === 'twitch') {
    const cacheKey = 'channels_twitch'
    if (!refresh) {
      const cached = getCached(cacheKey, TTL.CHANNELS)
      if (cached && !cached.stale) {
        return { items: cached.data, meta: buildMeta('twitch', true, new Date(Date.now() - cached.age).toISOString()) }
      }
    }
    const twLogins = CHANNEL_SEED.twitch.map(c => c.login)
    const items = await fetchTwitchChannels(twLogins)
    setCache(cacheKey, items)
    return { items, meta: buildMeta('twitch', false, new Date().toISOString()) }
  }

  // Default: all channels
  const cacheKey = 'channels_all'
  if (!refresh) {
    const cached = getCached(cacheKey, TTL.CHANNELS)
    if (cached && !cached.stale) {
      return { items: cached.data, meta: buildMeta('mixed', true, new Date(Date.now() - cached.age).toISOString()) }
    }
  }
  const ytIds = CHANNEL_SEED.youtube.map(c => c.id)
  const twLogins = CHANNEL_SEED.twitch.map(c => c.login)
  const [ytChannels, twChannels] = await Promise.all([
    fetchYouTubeChannels(ytIds),
    fetchTwitchChannels(twLogins),
  ])
  const items = [...ytChannels, ...twChannels]
  setCache(cacheKey, items)
  return { items, meta: buildMeta('mixed', false, new Date().toISOString()) }
}

// ─── For You Feed ─────────────────────────────────────────────────────────────

async function handleForYou(query) {
  const tokensParam = query.tokens || 'BTC,ETH,SOL'
  const tokens = tokensParam
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(t => t.length > 0)
    .slice(0, 5)

  const refresh = query.refresh === 'true'
  const cacheKey = `feed_for_you:${tokens.sort().join(',')}`

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.FOR_YOU)
    if (cached && !cached.stale) {
      return {
        items: cached.data,
        meta: buildMeta('mixed', true, new Date(Date.now() - cached.age).toISOString()),
      }
    }
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error('YouTube API key not configured')

  const perTokenResults = await Promise.allSettled(
    tokens.map(async (token) => {
      const tokenCacheKey = `yt_token:${token}`
      const cached = getCached(tokenCacheKey, TTL.FOR_YOU)
      if (cached && !cached.stale) return cached.data

      const searchRes = await ytSearch(`${token} crypto`, { maxResults: 10 })
      const items = (searchRes.items || [])
        .filter(i => i.snippet?.liveBroadcastContent !== 'live')
        .map(i => normalizeYtItem(i, {}, 'video'))

      setCache(tokenCacheKey, items)
      return items
    }),
  )

  const allItems = []
  for (const result of perTokenResults) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value)
    }
  }

  const seenIds = new Set()
  const deduped = allItems.filter(item => {
    if (seenIds.has(item.id)) return false
    seenIds.add(item.id)
    return true
  })

  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

  setCache(cacheKey, deduped)
  return { items: deduped, meta: buildMeta('youtube', false, new Date().toISOString()) }
}

// ─── Curated / Discover (Rollup-style) ────────────────────────────────────────

// A channel's uploads playlist id = its channel id with the 2nd char C->U.
// UCxxxx -> UUxxxx. Lets us fetch recent uploads for 1 quota unit (vs 100 for search).
function uploadsPlaylistId(channelId) {
  if (!channelId || channelId.length < 2 || channelId[1] !== 'C') return null
  return channelId.slice(0, 1) + 'U' + channelId.slice(2)
}

// Fetch up to `maxResults` recent uploads (snippet only) for one channel's
// uploads playlist. Returns [] on any failure (missing key, bad channel, upstream error).
async function fetchChannelUploads(channelId, maxResults = 5) {
  const apiKey = process.env.YOUTUBE_API_KEY
  const playlistId = uploadsPlaylistId(channelId)
  if (!apiKey || !playlistId) return []
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId,
      maxResults: String(maxResults),
      key: apiKey,
    })
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.items || []
  } catch {
    return []
  }
}

// Pull recent uploads across the premium channels, enrich with durations/stats,
// normalize to video items, filter shorts + live, dedup, sort newest-first.
async function getPremiumVideoItems(limit = 50) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || !PREMIUM_CHANNELS.length) return []

  const settled = await Promise.allSettled(
    PREMIUM_CHANNELS.slice(0, 18).map(ch => fetchChannelUploads(ch.id, 8)),
  )

  // Collect playlistItem snippets. A playlistItem snippet carries the videoId at
  // snippet.resourceId.videoId — reshape to the { id, snippet } form normalizeYtItem expects.
  const rawItems = []
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue
    for (const pi of r.value) {
      const videoId = pi.snippet?.resourceId?.videoId
      if (!videoId) continue
      rawItems.push({ id: videoId, snippet: pi.snippet, _live: pi.snippet?.liveBroadcastContent })
    }
  }
  if (!rawItems.length) return []

  // Batch-fetch durations/stats (ytVideoDetails caps fine; chunk to 50 per call).
  const ids = rawItems.map(i => i.id)
  const details = {}
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      Object.assign(details, await ytVideoDetails(chunk))
    } catch {
      // tolerate — items without details just lack duration/viewCount
    }
  }

  const videos = rawItems
    .filter(i => i._live !== 'live')
    .map(i => {
      const det = details[i.id] || {}
      i._durationSeconds = det.duration || 0
      return i
    })
    .filter(i => !isShort(i))
    .filter(i => !(i._durationSeconds > 0 && i._durationSeconds < 180))
    .map(i => normalizeYtItem(i, details, 'video'))

  const seen = new Set()
  const deduped = videos.filter(v => {
    if (seen.has(v.id)) return false
    seen.add(v.id)
    return true
  })
  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  return deduped.slice(0, limit)
}

// Pull recent uploads across the premium channels and keep only the genuine shorts
// (duration > 0 && <= 60s). Normalize to 'short' items, dedup, newest-first, slice.
// Tolerates every failure → []. Cached under 'premium_shorts' (reuses YT_VIDEOS ttl).
async function getPremiumShortItems(limit = 24) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey || !PREMIUM_CHANNELS.length) return []

  const cacheKey = 'premium_shorts'
  const cached = getCached(cacheKey, TTL.YT_VIDEOS)
  if (cached && !cached.stale) return cached.data

  const settled = await Promise.allSettled(
    PREMIUM_CHANNELS.map(ch => fetchChannelUploads(ch.id, 8)),
  )

  const rawItems = []
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue
    for (const pi of r.value) {
      const videoId = pi.snippet?.resourceId?.videoId
      if (!videoId) continue
      rawItems.push({ id: videoId, snippet: pi.snippet })
    }
  }
  if (!rawItems.length) return []

  const ids = rawItems.map(i => i.id)
  const details = {}
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      Object.assign(details, await ytVideoDetails(chunk))
    } catch {
      // tolerate — items without details just lack duration/viewCount
    }
  }

  const shorts = rawItems
    .map(i => {
      const det = details[i.id] || {}
      i._durationSeconds = det.duration || 0
      return i
    })
    .filter(i => i._durationSeconds > 0 && i._durationSeconds <= 60)
    .map(i => normalizeYtItem(i, details, 'short'))

  const seen = new Set()
  const deduped = shorts.filter(s => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  const items = deduped.slice(0, limit)

  if (items.length > 0) setCache(cacheKey, items)
  return items
}

// Shared curated-podcast fetch used by both podcasts/curated and feed/discover.
// For each show: search/byterm (max 1) -> top feed -> episodes/byfeedid (max 3).
// Tolerates per-show failure; returns [] if Podcast Index is unavailable.
async function getCuratedPodcastItems() {
  const cacheKey = 'podcasts_curated'
  const cached = getCached(cacheKey, TTL.PODCAST)
  if (cached && !cached.stale) return cached.data

  let headers = null
  try {
    headers = podcastIndexHeaders()
  } catch {
    // 🪤🪤 This used to `return []`. PODCAST_INDEX_KEY has never been set in
    // any environment, so every podcast surface — the Media Center feed AND the
    // Command Center tab — rendered "no episodes" forever while the endpoint
    // answered 200 in 200ms and looked healthy. Read the publisher feeds
    // instead: no key, same episodes, same audio.
    const rss = await getRssPodcastItems()
    return finishCuratedPodcasts(rss, cacheKey)
  }

  const fetchShow = async (term) => {
    const searchParams = new URLSearchParams({ q: term, max: '1' })
    const searchRes = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byterm?${searchParams}`,
      { headers, signal: AbortSignal.timeout(9000) },
    )
    if (!searchRes.ok) return []
    const searchData = await searchRes.json()
    const feed = (searchData.feeds || [])[0]
    if (!feed?.id) return []

    const epParams = new URLSearchParams({ id: String(feed.id), max: '4' })
    const epRes = await fetch(
      `https://api.podcastindex.org/api/1.0/episodes/byfeedid?${epParams}`,
      { headers, signal: AbortSignal.timeout(9000) },
    )
    if (!epRes.ok) return []
    const epData = await epRes.json()
    // The search result carries the show identity; episodes/byfeedid does not
    // always echo the feed title back, so stamp it here.
    return (epData.items || []).map(ep => ({
      ...normalizePodcastEpisode({ ...ep, feedTitle: ep.feedTitle || feed.title, feedImage: ep.feedImage || feed.image }),
      showTitle: feed.title || '',
      showId: feed.id,
    }))
  }

  // 47 shows x 2 upstream calls each cannot go out in one wave — the serverless
  // invocation would time out well before Podcast Index rate-limited us.
  const all = []
  const CONCURRENCY = 8
  for (let i = 0; i < CURATED_PODCASTS.length; i += CONCURRENCY) {
    const settled = await Promise.allSettled(
      CURATED_PODCASTS.slice(i, i + CONCURRENCY).map(fetchShow),
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value)
    }
  }

  // A key that exists but answers with nothing is the same outage as no key.
  if (!all.length) return finishCuratedPodcasts(await getRssPodcastItems(), cacheKey)

  return finishCuratedPodcasts(all, cacheKey)
}

/* Dedupe, newest-first, cap, cache — shared by both lanes so they cannot drift. */
function finishCuratedPodcasts(all, cacheKey) {
  const seen = new Set()
  const deduped = all.filter(ep => {
    if (!ep?.id || seen.has(ep.id)) return false
    seen.add(ep.id)
    return true
  })
  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  const items = deduped.slice(0, 160)

  if (items.length) setCache(cacheKey, items)
  return items
}

async function handlePodcastsCurated(query) {
  const refresh = query.refresh === 'true'
  const cacheKey = 'podcasts_curated'

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.PODCAST)
    if (cached && !cached.stale) {
      return {
        items: cached.data,
        meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()),
      }
    }
  }

  // getCuratedPodcastItems is self-caching + never throws.
  const items = await getCuratedPodcastItems()
  // Say which lane actually answered — 'podcast-rss' means we read the
  // publisher feeds directly because Podcast Index had no key or no results.
  return { items, meta: buildMeta(items[0]?.source || 'podcast-index', false, new Date().toISOString()) }
}

// ─── Transcripts (real captions) ─────────────────────────────────────────────
// KEEP IN SYNC with packages/server/routes/media.js — same parser, same field
// names. A drift here means captions work in dev and silently die in prod.

/* "00:01:02,345" | "00:01:02.345" | "01:02.345" | "62.5" → seconds */
function parseCueTime(str) {
  if (str == null) return null
  const s = String(str).trim().replace(',', '.')
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s)
  const parts = s.split(':').map(p => parseFloat(p))
  if (parts.some(p => Number.isNaN(p))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

const CUE_LINE_RE = /(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?/

/* SRT and WebVTT share a cue shape; one parser covers both. */
function parseSrtVtt(text) {
  const cues = []
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    const idx = lines.findIndex(l => CUE_LINE_RE.test(l))
    if (idx === -1) continue
    const [rawStart, rawEnd] = lines[idx].split('-->')
    const s = parseCueTime((rawStart || '').trim())
    const e = parseCueTime((rawEnd || '').trim().split(/\s+/)[0])
    if (s == null) continue
    let body = lines.slice(idx + 1).join(' ')
    let speaker = null
    const v = body.match(/<v(?:\.\w+)*\s+([^>]+)>/i)
    if (v) speaker = v[1].trim()
    body = body.replace(/<[^>]+>/g, '').trim()
    if (!body) continue
    if (!speaker) {
      const m = body.match(/^([A-Z][\w .'-]{1,28}):\s+(.*)$/)
      if (m) { speaker = m[1].trim(); body = m[2] }
    }
    cues.push({ s, e: e == null ? s + 4 : e, t: decodeHTMLEntities(body), sp: speaker })
  }
  return cues
}

/* podcast-namespace JSON: { segments: [{ startTime, endTime, body, speaker }] } */
function parseJsonTranscript(raw) {
  let data
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return [] }
  const segs = Array.isArray(data) ? data : (data.segments || data.results?.segments || [])
  if (!Array.isArray(segs)) return []
  const cues = []
  for (const sg of segs) {
    const s = parseCueTime(sg.startTime ?? sg.start ?? sg.start_time)
    if (s == null) continue
    const body = String(sg.body ?? sg.text ?? '').trim()
    if (!body) continue
    const e = parseCueTime(sg.endTime ?? sg.end ?? sg.end_time)
    cues.push({ s, e: e == null ? s + 4 : e, t: body, sp: sg.speaker || null })
  }
  return cues
}

/* Word-level transcripts are unreadable as a list — merge into caption lines.
   Never merges across a speaker change or a >2.5s silence. */
function mergeCues(cues, { maxChars = 140, maxSpan = 9 } = {}) {
  const out = []
  for (const c of cues) {
    const last = out[out.length - 1]
    const joinable = last
      && (c.sp || null) === (last.sp || null)
      && c.s - last.e < 2.5
      && last.t.length + c.t.length + 1 <= maxChars
      && c.e - last.s <= maxSpan
      && !/[.!?]["')\]]?$/.test(last.t)
    if (joinable) {
      last.t = `${last.t} ${c.t}`.replace(/\s+/g, ' ')
      last.e = c.e
    } else {
      out.push({ ...c })
    }
  }
  return out
}

const TRANSCRIPT_MAX_BYTES = 3 * 1024 * 1024

function parseTranscriptBody(text, contentType, url) {
  const ct = `${contentType || ''} ${url || ''}`.toLowerCase()
  let cues = []
  const looksJson = ct.includes('json') || /^\s*[[{]/.test(text)
  if (looksJson) cues = parseJsonTranscript(text)
  if (!cues.length && (ct.includes('vtt') || ct.includes('srt') || CUE_LINE_RE.test(text))) {
    cues = parseSrtVtt(text)
  }
  if (cues.length) {
    cues.sort((a, b) => a.s - b.s)
    return { kind: 'timed', cues: mergeCues(cues).slice(0, 6000), paragraphs: [] }
  }
  // No timings anywhere (plain text / HTML transcript). Still worth showing as a
  // readable transcript — it just cannot drive live captions, and says so.
  const plain = decodeHTMLEntities(String(text).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n'))
    .replace(/[ \t]+/g, ' ')
    .split(/\n{1,}/)
    .map(p => p.trim())
    .filter(p => p.length > 2)
  if (!plain.length) return { kind: 'none', cues: [], paragraphs: [] }
  return { kind: 'text', cues: [], paragraphs: plain.slice(0, 800) }
}

async function handlePodcastShow(query) {
  const q = (query.q || '').toString().trim()
  if (!q) return { feed: null, items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) }
  const max = Math.min(Number(query.max) || 24, 40)
  const cacheKey = `pod_show:${q.toLowerCase()}:${max}`

  const cached = getCached(cacheKey, TTL.PODCAST)
  if (cached && !cached.stale) {
    return { ...cached.data, meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()) }
  }

  try {
    const headers = podcastIndexHeaders()
    const sp = new URLSearchParams({ q, max: '1' })
    const sr = await fetch(`https://api.podcastindex.org/api/1.0/search/byterm?${sp}`, { headers, signal: AbortSignal.timeout(9000) })
    if (!sr.ok) throw new Error(`search ${sr.status}`)
    const feed = ((await sr.json()).feeds || [])[0]
    if (!feed?.id) return { feed: null, items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) }

    const ep = new URLSearchParams({ id: String(feed.id), max: String(max) })
    const er = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?${ep}`, { headers, signal: AbortSignal.timeout(9000) })
    const items = er.ok
      ? ((await er.json()).items || []).map(e => normalizePodcastEpisode({ ...e, feedTitle: e.feedTitle || feed.title, feedImage: e.feedImage || feed.image }))
      : []
    const payload = {
      feed: { id: feed.id, title: feed.title || '', author: feed.author || '', image: feed.image || feed.artwork || '', description: trimDescription(feed.description || '', 320), link: feed.link || '' },
      items,
    }
    if (items.length) setCache(cacheKey, payload)
    return { ...payload, meta: buildMeta('podcast-index', false, new Date().toISOString()) }
  } catch (err) {
    console.error('[media] podcasts/show error:', err.message)
    return { feed: null, items: [], meta: buildMeta('podcast-index', false, new Date().toISOString()) }
  }
}

async function handlePodcastTranscript(query) {
  const url = query.url
  if (!url || !/^https?:\/\//i.test(url)) {
    return { kind: 'none', cues: [], paragraphs: [], reason: 'bad-url' }
  }
  const cacheKey = `pod_transcript:${url}`
  const cached = getCached(cacheKey, 24 * 60 * 60 * 1000)
  if (cached && !cached.stale) {
    return { ...cached.data, meta: buildMeta('podcast-index', true, new Date(Date.now() - cached.age).toISOString()) }
  }

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'SpectreAI/1.0', 'Accept': 'application/json, text/vtt, application/x-subrip, text/plain, */*' },
    })
    if (!upstream.ok) throw new Error(`transcript ${upstream.status}`)
    const len = Number(upstream.headers.get('content-length') || 0)
    if (len > TRANSCRIPT_MAX_BYTES) throw new Error('transcript too large')
    const body = await upstream.text()
    if (body.length > TRANSCRIPT_MAX_BYTES) throw new Error('transcript too large')
    const parsed = parseTranscriptBody(body, upstream.headers.get('content-type'), url)
    const payload = { ...parsed, source: url }
    if (parsed.kind !== 'none') setCache(cacheKey, payload)
    return { ...payload, meta: buildMeta('podcast-index', false, new Date().toISOString()) }
  } catch (err) {
    console.error('[media] podcasts/transcript error:', err.message)
    return { kind: 'none', cues: [], paragraphs: [], source: url, reason: err.message, meta: buildMeta('podcast-index', false, new Date().toISOString()) }
  }
}

// ─── Spotify Latest Episodes ──────────────────────────────────────────────────

// Fetch the latest episode (duration + release date) per curated show. Keyed by
// show id so podcast cards can enrich their metadata. DEGRADES GRACEFULLY: when
// the Spotify creds aren't set (prod-only env), returns { items: {} } — never throws.
async function handleSpotifyLatest(query) {
  const refresh = query.refresh === 'true'
  const cacheKey = 'spotify_latest'

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.SPOTIFY)
    if (cached && !cached.stale) {
      return {
        items: cached.data,
        meta: buildMeta('spotify', true, new Date(Date.now() - cached.age).toISOString()),
      }
    }
  }

  const settled = await Promise.allSettled(
    APPLE_PODCASTS.map(async ({ spotifyId, appleId }) => {
      const ep = await fetchAppleLatest(appleId)
      return ep ? { id: spotifyId, ep } : null
    }),
  )

  const items = {}
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) items[r.value.id] = r.value.ep
  }

  setCache(cacheKey, items)
  return { items, meta: buildMeta('spotify', false, new Date().toISOString()) }
}

async function handleDiscover(query) {
  const refresh = query.refresh === 'true'
  const cacheKey = 'feed_discover'

  if (!refresh) {
    const cached = getCached(cacheKey, TTL.DISCOVER)
    if (cached && !cached.stale) {
      return cached.data
    }
  }

  // Source all three feeds in parallel; each helper already degrades to [] on failure.
  const [videosRes, podcastsRes, liveRes] = await Promise.allSettled([
    getPremiumVideoItems(80),
    getCuratedPodcastItems(),
    getPremiumLiveItems(),
  ])

  const videos = videosRes.status === 'fulfilled' ? videosRes.value : []
  const podcasts = podcastsRes.status === 'fulfilled' ? podcastsRes.value : []
  const live = (liveRes.status === 'fulfilled' && Array.isArray(liveRes.value))
    ? liveRes.value
    : []

  // Featured: prefer a fresh long-form video (>=10min) with a thumbnail, else freshest with a thumbnail.
  const withThumb = videos.filter(v => v.thumbnail)
  const featured =
    withThumb.find(v => v.duration >= 600) ||
    withThumb[0] ||
    null

  const featuredId = featured?.id
  const rest = videos.filter(v => v.id !== featuredId)

  const sections = [
    { id: 'new-releases', title: 'New Releases', layout: 'rail', items: rest.slice(0, 18) },
    { id: 'trending-podcasts', title: 'Trending Podcasts', layout: 'podcast', items: podcasts.slice(0, 14) },
  ]
  if (live.length) {
    sections.push({ id: 'live', title: 'Live Now', layout: 'rail', items: live.slice(0, 10) })
  }
  sections.push({ id: 'all', title: 'All Content', layout: 'grid', items: videos.slice(0, 48) })

  const payload = {
    featured,
    sections,
    meta: buildMeta('mixed', false, new Date().toISOString()),
  }

  // Never poison the 2h cache with an empty payload from a transient upstream
  // failure (e.g. a brief YouTube quota blip) — let the next request retry.
  if (featured || videos.length > 0 || podcasts.length > 0) {
    setCache(cacheKey, payload)
  }
  return payload
}

// ─── YouTube Comments (player live-comments panel) ────────────────────────────

// Fetch top-level comment threads for a video. Tolerates 403 / comments-disabled /
// any error → { items: [], meta }. NEVER throws — a video with comments off just []s.
async function handleYouTubeComments(query) {
  const videoId = query.videoId
  if (!videoId) {
    return { items: [], meta: buildMeta('youtube', false, new Date().toISOString()) }
  }

  const cacheKey = `yt_comments:${videoId}`
  const refresh = query.refresh === 'true'
  if (!refresh) {
    const cached = getCached(cacheKey, TTL.COMMENTS)
    if (cached && !cached.stale) {
      return {
        items: cached.data,
        meta: buildMeta('youtube', true, new Date(Date.now() - cached.age).toISOString()),
      }
    }
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return { items: [], meta: buildMeta('youtube', false, new Date().toISOString()) }
  }

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      videoId,
      order: 'relevance',
      maxResults: '25',
      textFormat: 'plainText',
      key: apiKey,
    })
    const res = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${params}`)
    if (!res.ok) {
      // 403 (comments disabled / quota), 404, etc. — degrade to empty.
      return { items: [], meta: buildMeta('youtube', false, new Date().toISOString()) }
    }
    const data = await res.json()
    const items = (data.items || []).map(thread => {
      const tlc = thread.snippet?.topLevelComment?.snippet || {}
      return {
        id: thread.id,
        author: tlc.authorDisplayName,
        avatarUrl: tlc.authorProfileImageUrl,
        text: tlc.textDisplay,
        likeCount: tlc.likeCount || 0,
        publishedAt: tlc.publishedAt,
      }
    })

    setCache(cacheKey, items)
    return { items, meta: buildMeta('youtube', false, new Date().toISOString()) }
  } catch {
    return { items: [], meta: buildMeta('youtube', false, new Date().toISOString()) }
  }
}

// ─── AI Synthesis (video / podcast TL;DR) ─────────────────────────────────────
// Free, reliable summaries from the content's own description / show-notes + an
// LLM (Groq). No transcript scraping (YouTube now blocks that server-side).

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.BRAIN_GROQ_MODEL || 'openai/gpt-oss-120b'
const SYNTH_SYSTEM = `You are Spectre, a crypto market-intelligence engine. Given a video or podcast title, source, and its description / show-notes, produce a fast, useful synthesis for a busy investor. Be concrete and specific to THIS content — no generic filler, no hedging. Never invent facts the text does not support. If the description is thin, summarize only what is actually there. Return JSON only: {"tldr":"one punchy sentence — the core thesis","points":["3 to 5 specific key points, claims, or topics actually covered"],"takeaway":"one sentence — why it matters now (omit forced crypto angles for non-crypto content)"}`

async function fetchVideoMeta(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY
  // Primary: YouTube Data API (reliable from serverless IPs).
  if (apiKey) {
    try {
      const params = new URLSearchParams({ part: 'snippet', id: videoId, key: apiKey })
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const sn = (await res.json()).items?.[0]?.snippet
        if (sn) return { title: sn.title || '', source: sn.channelTitle || '', desc: sn.description || '' }
      }
    } catch { /* fall through */ }
  }
  // Fallback: scrape the watch page for shortDescription (no key).
  try {
    const page = await (await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    })).text()
    const dm = page.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)
    const tm = page.match(/"title":"((?:[^"\\]|\\.)*)"/)
    const desc = dm ? JSON.parse(`"${dm[1]}"`) : ''
    const title = tm ? JSON.parse(`"${tm[1]}"`) : ''
    if (desc) return { title, source: '', desc }
  } catch { /* give up */ }
  return null
}

async function fetchPodcastMeta(spotifyId) {
  const entry = APPLE_PODCASTS.find(p => p.spotifyId === spotifyId)
  if (!entry) return null
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${entry.appleId}&media=podcast&entity=podcastEpisode&limit=3`, { signal: AbortSignal.timeout(7000) })
    if (!res.ok) return null
    const data = await res.json()
    const ep = (data.results || []).find(r => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode')
    const show = (data.results || []).find(r => r.wrapperType === 'track' || r.kind === 'podcast')
    if (!ep) return null
    return {
      title: ep.trackName || '',
      source: ep.collectionName || show?.collectionName || '',
      desc: ep.description || ep.shortDescription || show?.description || '',
    }
  } catch { return null }
}

async function handleSynthesize(query) {
  const kind = query.kind === 'podcast' ? 'podcast' : 'video'
  const id = (query.id || '').trim()
  if (!id) return { summary: null, meta: buildMeta('ai', false, new Date().toISOString()) }

  const cacheKey = `synth_${kind}_${id}`
  const cached = getCached(cacheKey, TTL.SYNTH)
  if (cached && !cached.stale) {
    return { summary: cached.data, meta: buildMeta('ai', true, new Date(Date.now() - cached.age).toISOString()) }
  }

  const meta = kind === 'podcast' ? await fetchPodcastMeta(id) : await fetchVideoMeta(id)
  const title = meta?.title || query.title || ''
  const desc = (meta?.desc || '').replace(/\s+/g, ' ').trim()

  // Not enough source text to synthesize honestly.
  if (desc.length < 80) {
    return { summary: null, reason: 'insufficient-source', meta: buildMeta('ai', false, new Date().toISOString()) }
  }

  try {
    // Resilient gateway (Groq → Cerebras/Gemini → OpenRouter → OpenAI/Anthropic
    // → Ollama). `smart` tier + json mode mirror the old direct-Groq synthesis;
    // the key check is gone so any live provider serves this (never-dark).
    const gw = await chat({
      messages: [
        { role: 'system', content: SYNTH_SYSTEM },
        { role: 'user', content: `Type: ${kind}\nTitle: ${title}\nSource: ${meta?.source || query.source || ''}\nDescription / show-notes:\n${desc.slice(0, 4000)}\n\nReturn the synthesis JSON.` },
      ],
      tier: 'smart',
      maxTokens: 600,
      temperature: 0.3,
      timeoutMs: 30000,
      json: true,
    })
    if (!gw.ok) return { summary: null, reason: 'llm-error', meta: buildMeta('ai', false, new Date().toISOString()) }
    const content = gw.text
    let parsed = null
    try { parsed = JSON.parse(content || '') } catch { parsed = null }
    if (!parsed || !parsed.tldr) return { summary: null, reason: 'llm-empty', meta: buildMeta('ai', false, new Date().toISOString()) }
    const summary = {
      tldr: String(parsed.tldr).trim(),
      points: Array.isArray(parsed.points) ? parsed.points.map(p => String(p).trim()).filter(Boolean).slice(0, 5) : [],
      takeaway: parsed.takeaway ? String(parsed.takeaway).trim() : '',
      title,
    }
    setCache(cacheKey, summary)
    return { summary, meta: buildMeta('ai', false, new Date().toISOString()) }
  } catch {
    return { summary: null, reason: 'llm-error', meta: buildMeta('ai', false, new Date().toISOString()) }
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { source, type } = req.query

  if (!source || !type) {
    return res.status(400).json({ error: 'Missing source or type parameter' })
  }

  try {
    let result
    switch (`${source}/${type}`) {
      case 'youtube/videos':   result = await handleYouTubeVideos(req.query); break
      case 'youtube/shorts':   result = await handleYouTubeShorts(req.query); break
      case 'youtube/live':     result = await handleYouTubeLive(req.query); break
      case 'youtube/comments': result = await handleYouTubeComments(req.query); break
      case 'twitch/live':      result = await handleTwitchLive(req.query); break
      case 'twitch/clips':     result = await handleTwitchClips(req.query); break
      case 'podcasts/search':  result = await handlePodcastSearch(req.query); break
      case 'podcasts/episodes': result = await handlePodcastEpisodes(req.query); break
      case 'podcasts/curated': result = await handlePodcastsCurated(req.query); break
      case 'podcasts/transcript': result = await handlePodcastTranscript(req.query); break
      case 'podcasts/show':       result = await handlePodcastShow(req.query); break
      case 'spotify/latest':   result = await handleSpotifyLatest(req.query); break
      case 'ai/synthesize':    result = await handleSynthesize(req.query); break
      case 'channels/all':
      case 'channels/youtube':
      case 'channels/twitch':  result = await handleChannels(type, req.query); break
      case 'feed/for-you':     result = await handleForYou(req.query); break
      case 'feed/discover':    result = await handleDiscover(req.query); break
      default:
        return res.status(400).json({ error: `Unknown route: ${source}/${type}` })
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return res.status(200).json(result)
  } catch (err) {
    console.error(`[media] API error [${source}/${type}]:`, err.message)
    return res.status(500).json({ error: err.message })
  }
}
