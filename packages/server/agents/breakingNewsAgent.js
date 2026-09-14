/**
 * Spectre Newsroom — Breaking News Agent (Tiered)
 * Real-time breaking news detection with TIER1/TIER2 classification.
 * Monitors RSS feeds every 10 minutes. RSS-only check is lightweight.
 * Only calls Perplexity (via newsWriterAgent) when a story qualifies.
 * Pushes notifications via SSE to connected clients.
 */
const { fetchRssFeed } = require('../lib/rssParser');
const { listArticles } = require('../content/store');
const { writeNewsBrief } = require('./newsWriterAgent');
const { logAgentActivity } = require('./activityLog');
const { getAgentState, incrementDailyCount, recordRun } = require('./agentState');
const { triggerBreakingUpdate } = require('./calendarAnalysisAgent');

const AGENT_NAME = 'breaking-news';

// ── BREAKING FEEDS ──
const BREAKING_FEEDS = [
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cointelegraph.com/rss',
  'https://www.theblock.co/rss.xml',
  'https://decrypt.co/feed',
  'https://blockworks.co/feed',
];

// ── CRYPTOPANIC API (important / hot news) ──
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY || '';
const CRYPTOPANIC_API = 'https://cryptopanic.com/api/v1/posts/';

// ── TIER 1 — Immediate generation, always publish ──
const BREAKING_TIER1 = [
  'hack', 'exploit', 'hacked', 'rug pull', 'emergency', 'halted',
  'sec charges', 'etf approved', 'etf denied', 'rate cut', 'rate hike',
  'fomc', 'insolvency', 'bankrupt', 'seized', 'arrested', 'indicted',
  'flash crash', 'drained', 'stolen', 'depegged',
  'breaking:', 'just in:',
  // Geopolitical — immediate market impact
  'war', 'missile', 'invasion', 'sanctions imposed', 'nuclear',
  'military strike', 'martial law', 'coup', 'assassination',
  'airstrike', 'air strike', 'launch strikes', 'strikes on',
  'bombing', 'attacked', 'escalation',
];

// ── TIER 2 — Generate only if newsworthiness score >= 7 ──
const BREAKING_TIER2 = [
  'record', 'billion', 'crash', 'surge', 'plunge', 'all-time high', 'ath',
  'delisted', 'banned', 'listed on', 'partnership', 'acquisition',
  'mainnet launch', 'airdrop', 'token burn',
  'whale', 'massive transfer', 'exchange outflow',
  'etf filing', 'etf launch', 'sec sues', 'sec approves',
  'regulatory crackdown', 'executive order',
  // Geopolitical & macro — score-gated
  'sanctions', 'tariffs', 'trade war', 'geopolitical', 'military',
  'nato', 'ceasefire', 'peace deal', 'oil embargo', 'central bank',
  'currency crisis', 'debt default', 'government shutdown',
];

// ── SOURCE TIER (boost for authoritative sources) ──
const SOURCE_TIER = {
  'CoinDesk': 3, 'CoinTelegraph': 3, 'The Block': 3,
  'Decrypt': 2, 'Blockworks': 2, 'DL News': 2,
  'Bloomberg': 4, 'Reuters': 4,
  'CryptoPanic': 2, 'Watcher.Guru': 3, 'ZachXBT': 3,
};

// ── BOOST KEYWORDS for scoring ──
const BOOST_KEYWORDS = [
  'etf', 'sec', 'fed', 'billion', 'million', 'hack', 'exploit',
  'crash', 'surge', 'record', 'bitcoin', 'ethereum', 'solana',
  'regulation', 'ban', 'approval', 'launch', 'institutional',
  'war', 'sanctions', 'tariff', 'military', 'geopolitical', 'crisis', 'emergency',
];

// ── RATE LIMITS ──
const MAX_BREAKING_PER_DAY = 8; // Breaking has no strict cap, but sane limit
const MAX_PER_CYCLE = 2;

// In-memory dedup within session
let publishedBreaking = new Set();

// Notification callback — set by the server when it boots
let _notificationCallback = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Classify a headline into TIER1, TIER2, or null (not breaking).
 */
function classifyBreakingTier(title, summary) {
  const text = `${title} ${summary || ''}`.toLowerCase();
  if (BREAKING_TIER1.some(kw => text.includes(kw))) return 'TIER1';
  if (BREAKING_TIER2.some(kw => text.includes(kw))) return 'TIER2';
  return null;
}

/**
 * Score newsworthiness (1-10). Used for TIER2 threshold check.
 */
function scoreNewsItem(item) {
  let score = 3;

  // Source authority
  const tier = SOURCE_TIER[item.source] || 1;
  score += (tier - 1);

  // Keyword boost
  const combined = `${item.title} ${item.summary || ''}`.toLowerCase();
  let hits = 0;
  for (const kw of BOOST_KEYWORDS) {
    if (combined.includes(kw)) hits++;
  }
  score += Math.min(hits, 3);

  // Recency boost
  if (item.publishedAt) {
    const ageMs = Date.now() - new Date(item.publishedAt).getTime();
    if (ageMs < 30 * 60 * 1000) score += 1; // < 30 min
  }

  return Math.max(1, Math.min(10, score));
}

/**
 * Word overlap for dedup.
 */
function wordOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / Math.min(wordsA.size, wordsB.size);
}

/**
 * Title similarity for stricter dedup.
 */
function titleSimilarity(a, b) {
  const STOP = new Set(['the','and','for','that','this','with','from','are','was','were','has','have','been','will','can','but','not','its','into','than','may','could','amid','over','after','while','says','new','more']);
  const extract = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
  const ka = extract(a), kb = extract(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  let ov = 0;
  for (const w of ka) if (kb.has(w)) ov++;
  return ov / Math.max(ka.size, kb.size);
}

/**
 * Check if story is already published.
 */
function isAlreadyPublished(headline) {
  if (publishedBreaking.has(headline)) return true;
  const published = listArticles('news', { limit: 50 });
  for (const article of published) {
    const existing = article.headline || article.title || '';
    if (wordOverlap(headline, existing) >= 0.40) return true;
    if (titleSimilarity(headline, existing) >= 0.50) return true;
  }
  return false;
}

/**
 * Register a notification callback (called by server on boot).
 */
function setNotificationCallback(cb) {
  _notificationCallback = cb;
}

/**
 * Push a breaking notification to connected clients.
 */
function pushBreakingNotification(article, tier) {
  if (!_notificationCallback) return;
  try {
    _notificationCallback({
      id: `notif_${Date.now()}`,
      type: tier === 'TIER1' ? 'breaking' : 'news',
      headline: article.headline || article.title,
      summary: (article.summary || '').slice(0, 120),
      articleUrl: `/intelligence/${article.type}/${article.slug}`,
      tickers: article.tickers || [],
      tier,
      timestamp: new Date().toISOString(),
      isRead: false,
    });
  } catch (e) {
    console.error('[breaking] Failed to push notification:', e.message);
  }
}

/**
 * Fetch important/hot posts from CryptoPanic API.
 * Returns items in the same shape as RSS items: { title, summary, source, publishedAt, link }.
 */
async function fetchCryptoPanic() {
  if (!CRYPTOPANIC_API_KEY) return [];
  try {
    const url = `${CRYPTOPANIC_API}?auth_token=${CRYPTOPANIC_API_KEY}&filter=important&kind=news&regions=en`;
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { console.warn('[breaking] CryptoPanic API:', r.status); return []; }
    const data = await r.json();
    const posts = Array.isArray(data.results) ? data.results : [];
    return posts.map(p => ({
      title: p.title || '',
      summary: p.title || '',
      source: p.source?.title || 'CryptoPanic',
      publishedAt: p.published_at || null,
      link: p.url || '',
    }));
  } catch (e) {
    console.warn('[breaking] CryptoPanic fetch error:', e.message);
    return [];
  }
}

/**
 * Run a single breaking news check cycle.
 * Lightweight: RSS fetch + keyword match. Perplexity only if story qualifies.
 */
async function runBreakingCheck() {
  const state = getAgentState(AGENT_NAME);

  if (state.dailyCount >= MAX_BREAKING_PER_DAY) {
    return { skipped: true, reason: 'daily_limit' };
  }

  recordRun(AGENT_NAME);
  const startTime = Date.now();

  try {
    // 1. Fetch all feeds + CryptoPanic in parallel (fast, no AI)
    const feedPromises = BREAKING_FEEDS.map(url => fetchRssFeed(url));
    feedPromises.push(fetchCryptoPanic()); // add CryptoPanic as extra source
    const feedResults = await Promise.allSettled(feedPromises);

    const allItems = [];
    let feedsOk = 0;
    for (const r of feedResults) {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        allItems.push(...r.value);
        feedsOk++;
      }
    }

    if (allItems.length === 0) {
      return { itemsChecked: 0, feedsOk, breakingFound: 0 };
    }

    // 2. Filter: items from last 60 minutes (1 hour window for RSS lag)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentItems = allItems.filter(item => {
      if (!item.publishedAt) return false;
      return new Date(item.publishedAt).getTime() > oneHourAgo;
    });

    // 3. Classify each item into TIER1/TIER2/null
    const candidates = [];
    for (const item of recentItems) {
      const tier = classifyBreakingTier(item.title, item.summary);
      if (!tier) continue;
      if (isAlreadyPublished(item.title)) continue;

      // TIER2 requires score >= 7
      if (tier === 'TIER2') {
        const score = scoreNewsItem(item);
        if (score < 7) continue;
        candidates.push({ ...item, tier, score });
      } else {
        // TIER1 always qualifies
        candidates.push({ ...item, tier, score: 10 });
      }
    }

    // Sort: TIER1 first, then by score
    candidates.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === 'TIER1' ? -1 : 1;
      return b.score - a.score;
    });

    if (candidates.length === 0) {
      return { itemsChecked: allItems.length, feedsOk, recentItems: recentItems.length, breakingFound: 0 };
    }

    const tier1Count = candidates.filter(c => c.tier === 'TIER1').length;
    console.log(`[breaking] Found ${candidates.length} breaking candidates (${tier1Count} TIER1)`);

    logAgentActivity({
      agent: 'breaking-news',
      action: 'started',
      target: `${candidates.length} candidates`,
      targetType: 'news',
      title: `Breaking detected: ${candidates[0].title?.slice(0, 60)}`,
    });

    // 4. Generate articles for top candidates
    const curState = getAgentState(AGENT_NAME);
    const remaining = MAX_BREAKING_PER_DAY - curState.dailyCount;
    const toWrite = candidates.slice(0, Math.min(MAX_PER_CYCLE, remaining));
    const written = [];

    for (const story of toWrite) {
      const article = await writeNewsBrief(story, {
        isBreaking: story.tier === 'TIER1',
        isFeatured: true,
      });

      if (article) {
        // Tag with tier info
        article.breakingTier = story.tier;
        article.isBreaking = story.tier === 'TIER1';

        written.push(article);
        incrementDailyCount(AGENT_NAME);
        publishedBreaking.add(story.title);

        // Push notification to connected clients
        pushBreakingNotification(article, story.tier);
      }
      if (written.length < toWrite.length) await sleep(2000);
    }

    // Trigger calendar themes+verdict refresh on TIER1 breaking news
    const hasTier1 = written.some(a => a.breakingTier === 'TIER1');
    if (hasTier1) {
      triggerBreakingUpdate().catch(e => {
        console.error('[breaking] Calendar update trigger failed:', e.message);
      });
    }

    const elapsed = Date.now() - startTime;
    const finalState = getAgentState(AGENT_NAME);

    if (written.length > 0) {
      logAgentActivity({
        agent: 'breaking-news',
        action: 'completed',
        target: written[0]?.headline?.slice(0, 60),
        targetType: 'news',
        title: `Published ${written.length} breaking (${(elapsed / 1000).toFixed(0)}s)`,
        generationTimeMs: elapsed,
      });
    }

    console.log(`[breaking] Cycle: ${written.length} breaking in ${(elapsed / 1000).toFixed(0)}s (daily: ${finalState.dailyCount}/${MAX_BREAKING_PER_DAY})`);

    return {
      itemsChecked: allItems.length,
      feedsOk,
      recentItems: recentItems.length,
      breakingFound: candidates.length,
      breakingWritten: written.length,
      breakingCount: finalState.dailyCount,
      elapsedMs: elapsed,
    };
  } catch (e) {
    logAgentActivity({
      agent: 'breaking-news',
      action: 'failed',
      target: 'breaking-check',
      targetType: 'news',
      title: `Breaking check failed: ${e.message}`,
      error: e.message,
    });
    console.error('[breaking] Check failed:', e.message);
    return { error: e.message };
  }
}

function getBreakingStats() {
  const state = getAgentState(AGENT_NAME);
  return {
    breakingCount: state.dailyCount,
    maxPerDay: MAX_BREAKING_PER_DAY,
    lastResetDate: state.lastResetDate,
    lastRunAt: state.lastRunAt,
    publishedCount: publishedBreaking.size,
  };
}

module.exports = {
  runBreakingCheck,
  getBreakingStats,
  setNotificationCallback,
  pushBreakingNotification,
  classifyBreakingTier,
  BREAKING_FEEDS,
  BREAKING_TIER1,
  BREAKING_TIER2,
};
