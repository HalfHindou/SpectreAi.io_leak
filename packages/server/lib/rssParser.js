/**
 * Spectre Intelligence Hub — Shared RSS Parser
 * Regex-based XML parser for RSS feeds. No external dependencies.
 */
const fetch = require('node-fetch');

const SOURCE_NAMES = {
  // Crypto
  'coindesk.com': 'CoinDesk',
  'cointelegraph.com': 'CoinTelegraph',
  'theblock.co': 'The Block',
  'decrypt.co': 'Decrypt',
  'bitcoinmagazine.com': 'Bitcoin Magazine',
  'blockworks.co': 'Blockworks',
  'dlnews.com': 'DL News',
  'cryptoslate.com': 'CryptoSlate',
  'beincrypto.com': 'BeInCrypto',
  'bitcoinist.com': 'Bitcoinist',
  'u.today': 'U.Today',
  'dailyhodl.com': 'Daily Hodl',
  'cryptopotato.com': 'CryptoPotato',
  // Tech
  'techcrunch.com': 'TechCrunch',
  'theverge.com': 'The Verge',
  'arstechnica.com': 'Ars Technica',
  'feeds.arstechnica.com': 'Ars Technica',
  'wired.com': 'Wired',
  'engadget.com': 'Engadget',
  'technologyreview.com': 'MIT Technology Review',
  // Business / Finance
  'cnbc.com': 'CNBC',
  'marketwatch.com': 'MarketWatch',
  'finance.yahoo.com': 'Yahoo Finance',
  'investing.com': 'Investing.com',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  // World / General
  'bbc.co.uk': 'BBC',
  'bbci.co.uk': 'BBC',
  'nytimes.com': 'New York Times',
  'theguardian.com': 'The Guardian',
  // Science
  'newscientist.com': 'New Scientist',
  'sciencedaily.com': 'Science Daily',
  // Energy
  'oilprice.com': 'OilPrice',
  // Tokenization / RWA / DeFi
  'thedefiant.io': 'The Defiant',
  'tokenist.com': 'The Tokenist',
  'protos.com': 'Protos',
  'news.bitcoin.com': 'Bitcoin.com',
  'bitcoin.com': 'Bitcoin.com',
  'ambcrypto.com': 'AMBCrypto',
  'coingape.com': 'CoinGape',
  'newsbtc.com': 'NewsBTC',
  // Business / Fintech
  'fortune.com': 'Fortune',
  'pymnts.com': 'PYMNTS',
  'crowdfundinsider.com': 'Crowdfund Insider',
};

/**
 * Extract a human-readable source name from a feed URL.
 */
function extractSourceName(feedUrl) {
  try {
    const hostname = new URL(feedUrl).hostname.replace('www.', '');
    for (const [domain, name] of Object.entries(SOURCE_NAMES)) {
      if (hostname.includes(domain)) return name;
    }
    return hostname;
  } catch (_) {
    return 'RSS';
  }
}

/**
 * Parse RSS XML into structured items.
 * @param {string} xml - Raw RSS XML
 * @param {string} [sourceName] - Override source name
 * @returns {Array} Parsed items
 */
function parseRssXml(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = (/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([^<]*)<\/title>/i.exec(block) || [])[1]
      || (/<title>([^<]*)<\/title>/i.exec(block) || [])[1] || '';
    const link = (/<link>([^<]*)<\/link>|<link href="([^"]*)"/i.exec(block) || [])[1]
      || (/\s<link>([^<]+)<\/link>/i.exec(block) || [])[1] || '#';
    const pubDate = (/<pubDate>([^<]*)<\/pubDate>/i.exec(block) || [])[1] || '';
    const desc = (/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([^<]*)<\/description>/i.exec(block) || [])[1]
      || (/<description>([^<]*)<\/description>/i.exec(block) || [])[1] || '';
    const summary = (desc || '').replace(/<[^>]+>/g, '').trim().slice(0, 200);
    const imgMatch = /<media:content[^>]*url="([^"]*)"|<enclosure[^>]*url="([^"]*)"/i.exec(block);
    const imageUrl = (imgMatch && (imgMatch[1] || imgMatch[2])) || null;

    const publishedOn = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

    if (title) {
      items.push({
        id: `rss-${items.length}-${Date.now()}`,
        title: title.trim(),
        url: link.trim(),
        summary,
        source: sourceName || 'RSS',
        imageUrl,
        publishedOn,
        publishedAt,
        categories: [],
      });
    }
  }
  return items;
}

/**
 * Fetch and parse a single RSS feed URL.
 * @param {string} feedUrl - The RSS feed URL
 * @param {number} [timeoutMs=8000] - Request timeout
 * @returns {Promise<Array>} Parsed items
 */
async function fetchRssFeed(feedUrl, timeoutMs = 8000) {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'SpectreAI-Research/1.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.warn(`[rss] HTTP ${response.status} for ${feedUrl}`);
      return [];
    }
    const xml = await response.text();
    const sourceName = extractSourceName(feedUrl);
    return parseRssXml(xml, sourceName);
  } catch (e) {
    console.warn('[rss] Fetch failed:', feedUrl, e.message);
    return [];
  }
}

/**
 * Fetch multiple RSS feeds in batches to avoid overwhelming connections.
 * @param {string[]} feedUrls
 * @param {number} [batchSize=8] - How many feeds to fetch in parallel per batch
 * @returns {Promise<Array>} Combined items from all feeds
 */
async function fetchMultipleFeeds(feedUrls, batchSize = 8) {
  const all = [];
  for (let i = 0; i < feedUrls.length; i += batchSize) {
    const batch = feedUrls.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(url => fetchRssFeed(url))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value);
    }
  }
  // Sort by publishedAt descending
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return all;
}

module.exports = { parseRssXml, extractSourceName, fetchRssFeed, fetchMultipleFeeds };
