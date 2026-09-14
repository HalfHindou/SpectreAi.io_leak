/**
 * Spectre Newsroom — News Curator Agent
 * Scans 7 crypto RSS feeds every 30 minutes.
 * Deduplicates, scores newsworthiness, and passes top stories to the writer.
 */
const { fetchRssFeed } = require('../lib/rssParser');
const { listArticles } = require('../content/store');
const { writeNewsBrief } = require('./newsWriterAgent');
const { logAgentActivity } = require('./activityLog');
const { getAgentState, incrementDailyCount, recordRun } = require('./agentState');

const AGENT_NAME = 'news-curator';

// ── RSS FEEDS ──
const NEWS_FEEDS = [
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cointelegraph.com/rss',
  'https://www.theblock.co/rss.xml',
  'https://decrypt.co/feed',
  'https://bitcoinmagazine.com/.rss/full/',
  'https://blockworks.co/feed',
  'https://www.dlnews.com/arc/outboundfeeds/rss/',
];

// ── RATE LIMITS (reduced from 24/3 → 8/2 to prevent content flood) ──
const MAX_PER_CYCLE = 2;
const MAX_PER_DAY = 8;

// ── IN-MEMORY STATE (dedup cache — loaded from disk on startup) ──
const MAX_RECENT = 500;

// Pre-load recent headlines from existing articles to prevent dupes after server restart
// We load BOTH the generated headline AND the original RSS source title for maximum coverage
let recentHeadlines = (() => {
  try {
    const existing = listArticles('news', { limit: MAX_RECENT });
    const headlines = [];
    for (const a of existing) {
      if (a.headline || a.title) headlines.push(a.headline || a.title);
      // Also load the original RSS title (different phrasing from generated headline)
      if (a.sourceArticle?.title) headlines.push(a.sourceArticle.title);
    }
    const unique = [...new Set(headlines.filter(Boolean))];
    console.log(`[curator] Pre-loaded ${unique.length} headlines for dedup (from ${existing.length} articles)`);
    return unique;
  } catch (_) { return []; }
})();

// ── HIGH-VALUE KEYWORDS (boost newsworthiness score) ──
const BOOST_KEYWORDS = [
  'etf', 'sec', 'fed', 'rate', 'billion', 'million', 'hack', 'exploit',
  'crash', 'surge', 'record', 'bitcoin', 'ethereum', 'solana',
  'regulation', 'ban', 'approval', 'launch', 'partnership',
  'acquisition', 'ipo', 'listing', 'delist', 'whale', 'institutional',
];

// ── SOURCE TIER (higher = more authoritative) ──
const SOURCE_TIER = {
  'CoinDesk': 3,
  'CoinTelegraph': 3,
  'The Block': 3,
  'Bloomberg': 4,
  'Reuters': 4,
  'Decrypt': 2,
  'Bitcoin Magazine': 2,
  'Blockworks': 2,
  'DL News': 2,
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate word overlap between two strings (0-1).
 */
function wordOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

/**
 * Title similarity — extracts key terms (strips stop words) and compares.
 * More aggressive than wordOverlap; catches "Bitcoin trapped at 67k..." vs "Bitcoin stuck at 67k..."
 */
const STOP_WORDS = new Set([
  'the','and','for','that','this','with','from','are','was','were','has','have',
  'been','will','can','but','not','its','into','than','may','could','amid','over',
  'after','while','says','new','more','about','just','also','now','here','what',
  'how','why','top','big','key','set','get','hit','hits','eyes','sees','gains',
  'shows','takes','makes','moves','looks','turns','faces','marks','leads','holds',
]);

function extractKeyTerms(s) {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function titleSimilarity(a, b) {
  const keysA = extractKeyTerms(a);
  const keysB = extractKeyTerms(b);
  if (keysA.size === 0 || keysB.size === 0) return 0;
  let overlap = 0;
  for (const w of keysA) if (keysB.has(w)) overlap++;
  return overlap / Math.max(keysA.size, keysB.size);
}

/**
 * Entity-based dedup — extracts core entities (proper nouns, tickers, company names)
 * and checks if two headlines are about the same entity + event.
 * "Coinbase Base ditches OP Stack..." and "Base breaks from Optimism..." → same story
 */
const ENTITY_KEYWORDS = new Set([
  'bitcoin','btc','ethereum','eth','solana','sol','xrp','cardano','ada','bnb',
  'dogecoin','doge','polygon','matic','avalanche','avax','chainlink','link',
  'coinbase','binance','kraken','robinhood','blackrock','grayscale','microstrategy',
  'sec','fed','cftc','treasury','jpmorgan','goldman','fidelity','vanguard',
  'base','optimism','arbitrum','zksync','starknet','scroll','blast','mantle',
  'uniswap','aave','lido','maker','curve','compound','opensea',
  'tether','usdt','usdc','circle','dai',
]);

function extractEntities(title) {
  const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  return new Set(words.filter(w => ENTITY_KEYWORDS.has(w)));
}

function entityOverlap(a, b) {
  const entA = extractEntities(a);
  const entB = extractEntities(b);
  if (entA.size === 0 || entB.size === 0) return 0;
  let overlap = 0;
  for (const e of entA) if (entB.has(e)) overlap++;
  // If they share 2+ entities, it's likely the same story
  return overlap;
}

/**
 * Check if a headline is a duplicate of something we've already seen.
 * Uses THREE methods:
 * 1. Word overlap ≥ 35% (catches near-identical titles)
 * 2. Title similarity ≥ 40% (catches paraphrased titles)
 * 3. Entity overlap ≥ 2 AND title similarity ≥ 25% (catches same-story different wording)
 */
function isDuplicate(headline) {
  for (const existing of recentHeadlines) {
    if (wordOverlap(headline, existing) >= 0.35) return true;
    const tsim = titleSimilarity(headline, existing);
    if (tsim >= 0.40) return true;
    // Same entities + moderate similarity = same story
    if (entityOverlap(headline, existing) >= 2 && tsim >= 0.25) return true;
  }
  return false;
}

/**
 * Check if headline matches an already-published article.
 * Checks against BOTH the generated headline AND the original source title.
 */
function isAlreadyPublished(headline) {
  const published = listArticles('news', { limit: 100 });
  for (const article of published) {
    const titles = [
      article.headline || article.title || '',
      article.sourceArticle?.title || '',
    ].filter(Boolean);
    for (const existing of titles) {
      if (wordOverlap(headline, existing) >= 0.35) return true;
      const tsim = titleSimilarity(headline, existing);
      if (tsim >= 0.40) return true;
      if (entityOverlap(headline, existing) >= 2 && tsim >= 0.25) return true;
    }
  }
  return false;
}

/**
 * Score newsworthiness of an RSS item (1-10).
 */
function scoreNewsworthiness(item) {
  let score = 3; // base score

  // Source tier
  const tier = SOURCE_TIER[item.source] || 1;
  score += (tier - 1); // +0 to +3

  // Keyword boost
  const titleLower = (item.title || '').toLowerCase();
  const summaryLower = (item.summary || '').toLowerCase();
  const combined = titleLower + ' ' + summaryLower;
  let keywordHits = 0;
  for (const kw of BOOST_KEYWORDS) {
    if (combined.includes(kw)) keywordHits++;
  }
  score += Math.min(keywordHits, 3); // max +3 from keywords

  // Recency boost — items < 1 hour old get +1
  if (item.publishedAt) {
    const ageMs = Date.now() - new Date(item.publishedAt).getTime();
    if (ageMs < 60 * 60 * 1000) score += 1; // < 1 hour
    if (ageMs > 24 * 60 * 60 * 1000) score -= 2; // > 24 hours penalty
  }

  return Math.max(1, Math.min(10, score));
}

/**
 * Run a single curator cycle.
 * Fetches feeds, deduplicates, scores, and writes top stories.
 */
async function runCuratorCycle() {
  const state = getAgentState(AGENT_NAME);

  if (state.dailyCount >= MAX_PER_DAY) {
    console.log(`[curator] Daily limit reached (${state.dailyCount}/${MAX_PER_DAY}), skipping cycle`);
    return { skipped: true, reason: 'daily_limit' };
  }

  recordRun(AGENT_NAME);

  const startTime = Date.now();

  logAgentActivity({
    agent: 'news-curator',
    action: 'started',
    target: 'feeds',
    targetType: 'news',
    title: `Scanning ${NEWS_FEEDS.length} RSS feeds`,
  });

  try {
    // 1. Fetch all feeds in parallel
    const feedResults = await Promise.allSettled(
      NEWS_FEEDS.map(url => fetchRssFeed(url))
    );

    const allItems = [];
    let feedsSucceeded = 0;
    for (const r of feedResults) {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        allItems.push(...r.value);
        feedsSucceeded++;
      }
    }

    console.log(`[curator] Fetched ${allItems.length} items from ${feedsSucceeded}/${NEWS_FEEDS.length} feeds`);

    if (allItems.length === 0) {
      logAgentActivity({
        agent: 'news-curator',
        action: 'completed',
        target: 'feeds',
        targetType: 'news',
        title: 'No items found from any feed',
      });
      return { itemsFetched: 0, articlesWritten: 0 };
    }

    // 2. Filter: only items from last 6 hours
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const recentItems = allItems.filter(item => {
      if (!item.publishedAt) return true; // include if no date
      return new Date(item.publishedAt).getTime() > sixHoursAgo;
    });

    // 3. Deduplicate
    const uniqueItems = [];
    for (const item of recentItems) {
      if (!isDuplicate(item.title) && !isAlreadyPublished(item.title)) {
        uniqueItems.push(item);
        // Add to recent headlines for future dedup
        recentHeadlines.push(item.title);
        if (recentHeadlines.length > MAX_RECENT) recentHeadlines.shift();
      }
    }

    console.log(`[curator] ${recentItems.length} recent → ${uniqueItems.length} unique after dedup`);

    // 4. Score and rank
    const scored = uniqueItems.map(item => ({
      ...item,
      score: scoreNewsworthiness(item),
    }));
    scored.sort((a, b) => b.score - a.score);

    // 5. Take top stories (score ≥ 4, max per cycle)
    const curState = getAgentState(AGENT_NAME);
    const remaining = MAX_PER_DAY - curState.dailyCount;
    const maxThisCycle = Math.min(MAX_PER_CYCLE, remaining);
    const topStories = scored.filter(s => s.score >= 4).slice(0, maxThisCycle);

    console.log(`[curator] Top ${topStories.length} stories (score ≥ 4) selected for writing`);

    // 6. Write articles sequentially
    const written = [];
    for (const story of topStories) {
      const isFeatured = story.score >= 7;
      const article = await writeNewsBrief(story, { isFeatured });
      if (article) {
        written.push(article);
        incrementDailyCount(AGENT_NAME);
      }
      await sleep(2000); // 2s delay between writes
    }

    const elapsed = Date.now() - startTime;
    const finalState = getAgentState(AGENT_NAME);

    logAgentActivity({
      agent: 'news-curator',
      action: 'completed',
      target: `${written.length} articles`,
      targetType: 'news',
      title: `Wrote ${written.length}/${topStories.length} briefs (${(elapsed / 1000).toFixed(0)}s)`,
      generationTimeMs: elapsed,
    });

    console.log(`[curator] Cycle complete: ${written.length} articles written in ${(elapsed / 1000).toFixed(0)}s (daily: ${finalState.dailyCount}/${MAX_PER_DAY})`);

    return {
      itemsFetched: allItems.length,
      feedsSucceeded,
      recentItems: recentItems.length,
      uniqueItems: uniqueItems.length,
      topStories: topStories.length,
      articlesWritten: written.length,
      dailyCount: finalState.dailyCount,
      elapsedMs: elapsed,
    };
  } catch (e) {
    logAgentActivity({
      agent: 'news-curator',
      action: 'failed',
      target: 'feeds',
      targetType: 'news',
      title: `Curator failed: ${e.message}`,
      error: e.message,
    });
    console.error('[curator] Cycle failed:', e.message);
    return { error: e.message };
  }
}

/**
 * Get curator stats.
 */
function getCuratorStats() {
  const state = getAgentState(AGENT_NAME);
  return {
    dailyCount: state.dailyCount,
    maxPerDay: MAX_PER_DAY,
    maxPerCycle: MAX_PER_CYCLE,
    recentHeadlines: recentHeadlines.length,
    lastResetDate: state.lastResetDate,
    lastRunAt: state.lastRunAt,
  };
}

module.exports = { runCuratorCycle, getCuratorStats, NEWS_FEEDS };
