/**
 * Vercel Serverless – RSS news aggregator.
 * GET /api/news-rss?symbol=BTC&limit=10 (vercel.json rewrites /api/news/rss -> /api/news-rss)
 * Fetches RSS feeds from CoinDesk and CoinTelegraph, parses XML without external deps,
 * filters by symbol keyword, deduplicates, and returns structured results.
 */

const RSS_FEEDS = [
  // ── Crypto ──
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
  { url: 'https://cointelegraph.com/rss', source: 'CoinTelegraph' },
  { url: 'https://www.theblock.co/rss.xml', source: 'The Block' },
  { url: 'https://decrypt.co/feed', source: 'Decrypt' },
  { url: 'https://blockworks.co/feed', source: 'Blockworks' },
  { url: 'https://cryptoslate.com/feed/', source: 'CryptoSlate' },
  { url: 'https://beincrypto.com/feed/', source: 'BeInCrypto' },
  { url: 'https://bitcoinist.com/feed/', source: 'Bitcoinist' },
  { url: 'https://u.today/rss', source: 'U.Today' },
  { url: 'https://dailyhodl.com/feed/', source: 'Daily Hodl' },
  { url: 'https://cryptopotato.com/feed/', source: 'CryptoPotato' },
  // ── Tech ──
  { url: 'https://techcrunch.com/feed/', source: 'TechCrunch' },
  { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica' },
  { url: 'https://www.wired.com/feed/rss', source: 'Wired' },
  { url: 'https://www.engadget.com/rss.xml', source: 'Engadget' },
  { url: 'https://www.technologyreview.com/feed/', source: 'MIT Technology Review' },
  // ── Business / Finance ──
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch' },
  { url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance' },
  { url: 'https://www.investing.com/rss/news.rss', source: 'Investing.com' },
  // ── World / General ──
  { url: 'https://feeds.bbci.co.uk/news/rss.xml', source: 'BBC' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', source: 'New York Times' },
  { url: 'https://www.theguardian.com/world/rss', source: 'The Guardian' },
  { url: 'https://feeds.reuters.com/reuters/topNews', source: 'Reuters' },
  // ── Science ──
  { url: 'https://www.newscientist.com/section/news/feed/', source: 'New Scientist' },
  { url: 'https://www.sciencedaily.com/rss/all.xml', source: 'Science Daily' },
  // ── Energy ──
  { url: 'https://oilprice.com/rss/main', source: 'OilPrice' },
  // ── Tokenization / RWA / DeFi (specialized) ──
  { url: 'https://cointelegraph.com/rss/tag/tokenization', source: 'CoinTelegraph' },
  { url: 'https://thedefiant.io/feed', source: 'The Defiant' },
  { url: 'https://tokenist.com/feed/', source: 'The Tokenist' },
  { url: 'https://protos.com/feed/', source: 'Protos' },
  { url: 'https://news.bitcoin.com/feed/', source: 'Bitcoin.com' },
  { url: 'https://ambcrypto.com/feed/', source: 'AMBCrypto' },
  { url: 'https://coingape.com/feed/', source: 'CoinGape' },
  { url: 'https://www.newsbtc.com/feed/', source: 'NewsBTC' },
  // ── Business / Fintech ──
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', source: 'New York Times' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC' },
  { url: 'https://fortune.com/feed/', source: 'Fortune' },
  { url: 'https://www.pymnts.com/feed/', source: 'PYMNTS' },
  { url: 'https://www.crowdfundinsider.com/feed/', source: 'Crowdfund Insider' },
];

/**
 * Parse RSS <item> blocks from XML using regex (no external dependencies).
 */
function parseRssItems(xml, source) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
    const imgMatch = block.match(/(?:<media:content[^>]*url=["'])([^"']+)/);
    const enclosureMatch = block.match(/<enclosure[^>]*url=["']([^"']+)/);
    const imageUrl = imgMatch ? imgMatch[1] : enclosureMatch ? enclosureMatch[1] : null;

    if (title.trim()) {
      items.push({
        title: title.trim(),
        link: link.trim(),
        publishedAt: pubDate.trim(),
        summary: desc.replace(/<[^>]+>/g, '').trim().slice(0, 160),
        imageUrl,
        source,
      });
    }
  }
  return items;
}

async function fetchFeed(feedUrl, source) {
  try {
    const r = await fetch(feedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'Spectre-RSS/1.0',
      },
    });
    if (!r.ok) {
      console.warn(`RSS feed ${source} returned ${r.status}`);
      return [];
    }
    const xml = await r.text();
    return parseRssItems(xml, source);
  } catch (err) {
    console.warn(`RSS feed ${source} error:`, err.message);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

    // Fetch feeds in batches of 8 to avoid overwhelming connections
    const feedResults = [];
    const BATCH = 8;
    for (let i = 0; i < RSS_FEEDS.length; i += BATCH) {
      const batch = RSS_FEEDS.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(({ url, source }) => fetchFeed(url, source))
      );
      feedResults.push(...results);
    }

    // Flatten all items
    let allItems = feedResults.flat();

    // Filter by symbol keyword if provided
    if (symbol) {
      // Build search terms for common crypto symbols
      const symbolMap = {
        BTC: ['btc', 'bitcoin'],
        ETH: ['eth', 'ethereum'],
        SOL: ['sol', 'solana'],
        XRP: ['xrp', 'ripple'],
        ADA: ['ada', 'cardano'],
        DOGE: ['doge', 'dogecoin'],
        DOT: ['dot', 'polkadot'],
        AVAX: ['avax', 'avalanche'],
        LINK: ['link', 'chainlink'],
        BNB: ['bnb', 'binance'],
      };
      const terms = symbolMap[symbol] || [symbol.toLowerCase()];

      const filtered = allItems.filter((item) => {
        const text = `${item.title} ${item.summary}`.toLowerCase();
        return terms.some((term) => text.includes(term));
      });

      // Use filtered if enough results, otherwise fall back to all
      if (filtered.length >= 3) {
        allItems = filtered;
      }
    }

    // Sort by published date (newest first)
    allItems.sort((a, b) => {
      const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return db - da;
    });

    // Deduplicate by title prefix (first 80 chars)
    const seen = new Set();
    const deduped = [];
    for (const item of allItems) {
      const key = item.title.slice(0, 80).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    // Build response with IDs
    const results = deduped.slice(0, limit).map((item, i) => ({
      id: `rss-${i}-${Date.now()}`,
      title: item.title,
      summary: item.summary,
      source: item.source,
      publishedAt: item.publishedAt,
      link: item.link,
      imageUrl: item.imageUrl,
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=90, stale-while-revalidate=180');
    return res.status(200).json({ results });
  } catch (err) {
    console.error('News RSS proxy error:', err.message);
    return res.status(502).json({ error: 'RSS feeds unavailable', results: [] });
  }
}
