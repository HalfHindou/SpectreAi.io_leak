/**
 * War Room — Real-time Intelligence Feed + Conversational AI endpoints.
 * GET  /intel  — Real news from RSS + content store, categorized & sorted
 * POST /ask    — Streaming single-shot answer using live market context
 */
const express = require('express');
const router = express.Router();
const { fetchMultipleFeeds } = require('../lib/rssParser');

let listArticles;
try {
  listArticles = require('../content/store').listArticles;
} catch (_) {
  listArticles = null;
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';
const COINGECKO_BASE = COINGECKO_API_KEY
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

/* ── Rate limiter ── */
function createRateLimiter(windowMs, max) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) { if (now - e.start > windowMs) hits.delete(ip); }
  }, 60_000);
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const e = hits.get(ip);
    if (!e || now - e.start > windowMs) { hits.set(ip, { start: now, count: 1 }); return next(); }
    e.count++;
    if (e.count > max) {
      res.set('Retry-After', String(Math.ceil((e.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests.' });
    }
    next();
  };
}
const askLimit = createRateLimiter(60_000, 10);
const intelLimit = createRateLimiter(60_000, 6);


/* ── HTML entity decoder for RSS titles ── */
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}


/* ═══════════════════════════════════════════════════════════
   CATEGORY DETECTION
   ═══════════════════════════════════════════════════════════ */
const MACRO_KEYWORDS = [
  'fed ', 'federal reserve', 'interest rate', 'inflation', 'cpi', 'ppi', 'gdp',
  'tariff', 'trade war', 'geopolit', 'iran', 'israel', 'china', 'russia', 'war',
  'oil', 'crude', 'gold', 'treasury', 'bond', 'yield', 'dollar', 'dxy', 'forex',
  'recession', 'unemployment', 'jobs', 'nonfarm', 'fomc', 'powell', 'ecb', 'boj',
  'regulation', 'sec ', 'congress', 'legislation', 'ban', 'sanction', 'nuclear',
  'euro', 'yen', 'yuan', 'sterling', 'franc', 'commodity', 'energy', 'natural gas',
  'stock', 'equity', 'nasdaq', 's&p', 'dow', 'earnings', 'ipo',
  'supreme court', 'president', 'trump', 'biden', 'election', 'vote',
  'safe haven', 'risk-off', 'risk off', 'stagflation', 'central bank',
];

const STOCK_KEYWORDS = [
  'stock', 'equity', 'nasdaq', 's&p 500', 'dow jones', 'ipo', 'earnings',
  'revenue', 'profit', 'dividend', 'share', 'valuation', 'pe ratio',
  'wall street', 'nyse', 'market cap', 'public offering', 'analyst',
];

function detectCategory(title, summary, categories) {
  const text = `${title} ${summary || ''} ${(categories || []).join(' ')}`.toLowerCase();

  let macroScore = 0;
  let cryptoScore = 0;
  let stockScore = 0;

  // Only count strong macro signals (geopolitical, central bank, commodities)
  const strongMacro = [
    'iran', 'israel', 'war', 'nuclear', 'geopolit', 'missile', 'conflict',
    'federal reserve', 'fomc', 'powell', 'rate cut', 'rate hike', 'inflation',
    'cpi', 'gdp', 'recession', 'tariff', 'trade war',
    'crude oil', 'oil surge', 'oil price', 'gold price', 'safe haven',
    'treasury yield', 'bond yield', 'dxy', 'dollar index',
    'ecb', 'boj', 'central bank', 'stagflation',
  ];
  for (const kw of strongMacro) {
    if (text.includes(kw)) macroScore += 2;
  }
  // Weak macro signals (can appear in crypto articles too)
  const weakMacro = ['fed ', 'sec ', 'regulation', 'congress', 'legislation',
    'supreme court', 'president', 'trump', 'election', 'sanction'];
  for (const kw of weakMacro) {
    if (text.includes(kw)) macroScore += 1;
  }

  for (const kw of STOCK_KEYWORDS) {
    if (text.includes(kw)) stockScore++;
  }

  const cryptoKw = ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto',
    'defi', 'nft', 'token', 'blockchain', 'on-chain', 'onchain', 'whale',
    'staking', 'mining', 'hash', 'wallet', 'exchange', 'dex', 'altcoin',
    'stablecoin', 'usdt', 'usdc', 'layer 2', 'l2', 'dao', 'protocol',
    'binance', 'coinbase', 'bitfinex', 'bybit', 'kraken', 'uniswap'];
  for (const kw of cryptoKw) {
    if (text.includes(kw)) cryptoScore++;
  }

  // Macro only wins if it's clearly dominant (strong signals, outscoring crypto)
  if (macroScore >= 4 && macroScore > cryptoScore) return 'macro';
  if (stockScore >= 2 && stockScore > cryptoScore && cryptoScore === 0) return 'stocks';
  if (cryptoScore > 0) return 'crypto';

  // Fallback: if only macro signals present, it's macro
  return macroScore > 0 ? 'macro' : 'crypto';
}


/* ═══════════════════════════════════════════════════════════
   SOURCE METADATA
   ═══════════════════════════════════════════════════════════ */
const SOURCE_ICONS = {
  'CoinDesk':         { icon: 'coindesk',     color: '#0052FF' },
  'CoinTelegraph':    { icon: 'cointelegraph', color: '#F7931A' },
  'The Block':        { icon: 'theblock',      color: '#ffffff' },
  'Decrypt':          { icon: 'decrypt',       color: '#2CFF4E' },
  'Bitcoin Magazine':  { icon: 'btcmag',       color: '#F7931A' },
  'Blockworks':       { icon: 'blockworks',    color: '#6366F1' },
  'DL News':          { icon: 'dlnews',        color: '#FF6B6B' },
  'Bloomberg':        { icon: 'bloomberg',     color: '#472A91' },
  'Reuters':          { icon: 'reuters',       color: '#FF8000' },
  'Spectre Market Data':    { icon: 'spectre', color: '#8B5CF6' },
  'Spectre On-Chain':       { icon: 'spectre', color: '#8B5CF6' },
  'Spectre Sentiment':      { icon: 'spectre', color: '#8B5CF6' },
  'Spectre Sectors':        { icon: 'spectre', color: '#8B5CF6' },
  'Spectre Whale Tracker':  { icon: 'spectre', color: '#8B5CF6' },
  'Alternative.me':         { icon: 'fng',     color: '#F59E0B' },
};

function getSourceMeta(sourceName) {
  return SOURCE_ICONS[sourceName] || { icon: 'default', color: '#666666' };
}


/* ═══════════════════════════════════════════════════════════
   RSS FEEDS — multi-domain for macro + crypto mix
   ═══════════════════════════════════════════════════════════ */
const RSS_FEEDS = [
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cointelegraph.com/rss',
  'https://www.theblock.co/rss.xml',
  'https://decrypt.co/feed',
  'https://blockworks.co/feed',
  'https://www.dlnews.com/arc/outboundfeeds/rss/',
];


/* ═══════════════════════════════════════════════════════════
   GET /intel — Real-time Intelligence Feed
   ═══════════════════════════════════════════════════════════ */
const intelCache = { data: null, expires: 0 };

router.get('/intel', intelLimit, async (req, res) => {
  // Serve cached
  if (intelCache.data && Date.now() < intelCache.expires) {
    return res.json(intelCache.data);
  }

  try {
    const stories = [];
    const allSources = new Set();
    const seenHeadlines = new Set();

    // 1. Pull from content store (curated articles — highest quality)
    if (listArticles) {
      try {
        const storeArticles = listArticles('news', { limit: 15 });
        for (const a of storeArticles) {
          const headline = a.headline || a.title;
          if (!headline || seenHeadlines.has(headline.toLowerCase())) continue;
          seenHeadlines.add(headline.toLowerCase());

          const source = a.sourceArticle?.source || 'Spectre Intelligence';
          allSources.add(source);

          stories.push({
            id: a.slug || `store-${stories.length}`,
            headline,
            brief: (a.summary || '').replace(/<[^>]+>/g, '').replace(headline, '').trim().slice(0, 300),
            category: detectCategory(headline, a.summary, a.categories),
            source,
            sourceMeta: getSourceMeta(source),
            sourceUrl: a.sourceArticle?.url || a.canonicalUrl || null,
            tickers: a.tickers || [],
            isBreaking: a.isBreaking || false,
            timestamp: a.publishedAt || a.updatedAt || new Date().toISOString(),
          });
        }
      } catch (err) {
        console.warn('[war-room] Content store read error:', err.message);
      }
    }

    // 2. Pull from live RSS feeds (latest headlines)
    try {
      const rssItems = await fetchMultipleFeeds(RSS_FEEDS);
      for (const item of rssItems.slice(0, 20)) {
        const headline = item.title;
        if (!headline || seenHeadlines.has(headline.toLowerCase())) continue;
        seenHeadlines.add(headline.toLowerCase());

        allSources.add(item.source);

        stories.push({
          id: item.id || `rss-${stories.length}`,
          headline: decodeEntities(headline),
          brief: decodeEntities((item.summary || '').trim().slice(0, 300)),
          category: detectCategory(headline, item.summary, item.categories),
          source: item.source,
          sourceMeta: getSourceMeta(item.source),
          sourceUrl: item.url || null,
          tickers: [],
          isBreaking: false,
          timestamp: item.publishedAt || new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn('[war-room] RSS fetch error:', err.message);
    }

    // 3. Sort: macro first, then by recency within each category
    const categoryOrder = { macro: 0, stocks: 1, crypto: 2 };
    stories.sort((a, b) => {
      const catDiff = (categoryOrder[a.category] ?? 3) - (categoryOrder[b.category] ?? 3);
      if (catDiff !== 0) return catDiff;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    // Limit to top 10 stories
    const topStories = stories.slice(0, 10);

    // Build source list with metadata
    const sourceList = [...allSources].map(name => ({
      name,
      ...getSourceMeta(name),
    }));

    const result = {
      stories: topStories,
      sources: sourceList,
      sourceCount: allSources.size,
      generatedAt: new Date().toISOString(),
    };

    // Cache 5 minutes (shorter since it's real data now)
    intelCache.data = result;
    intelCache.expires = Date.now() + 5 * 60 * 1000;

    res.json(result);
  } catch (err) {
    console.error('War Room intel error:', err);
    if (intelCache.data) return res.json(intelCache.data);
    res.json({ stories: getFallbackStories(), sources: [], sourceCount: 0 });
  }
});


/* ═══════════════════════════════════════════════════════════
   POST /ask — Streaming War Room answer
   ═══════════════════════════════════════════════════════════ */
router.post('/ask', askLimit, async (req, res) => {
  const { query, context } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query required' });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI service not configured' });
  }

  const ctx = context || {};
  const contextBlock = `
LIVE MARKET DATA (as of ${ctx.timestamp || new Date().toISOString()}):
- BTC: $${ctx.btcPrice?.toLocaleString() || 'N/A'}
- ETH: $${ctx.ethPrice?.toLocaleString() || 'N/A'}
- SOL: $${ctx.solPrice?.toLocaleString() || 'N/A'}
- Fear & Greed: ${ctx.fearGreed || 'N/A'}/100
  `.trim();

  const systemPrompt = `You are Spectre AI's War Room analyst. You answer questions about crypto markets with precision and brevity.

Rules:
- 3-5 sentences MAXIMUM. No lists. No headers. Just sharp prose.
- Use ONLY the live data provided as context. Never fabricate numbers.
- Be direct. Say what the data suggests. Flag uncertainty with "signals suggest" or "data points to".
- Never say "I" or "As an AI". Speak as the terminal itself.
- Never say "great question" or any filler.
- If you don't have enough data to answer, say "Insufficient data in current feed — check Research Zone for deeper analysis."

${contextBlock}`;

  try {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: query.trim() }],
        stream: true,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).json({ error: 'Analysis unavailable' });
    }

    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.text) {
              res.write(data.delta.text);
            }
          } catch { /* skip non-JSON lines */ }
        }
      }
    }

    res.end();
  } catch (err) {
    console.error('War Room ask error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Analysis unavailable' });
    } else {
      res.end();
    }
  }
});


/* ── Fallback stories (used when no content store / RSS available) ── */
function getFallbackStories() {
  return [
    {
      id: 'fb-1',
      headline: 'U.S.-Iran Tensions Escalate as Oil Prices Surge',
      brief: 'Geopolitical risk intensifies across Middle East conflict zones. Oil jumped 5% while safe-haven assets rally. Markets brace for potential supply disruptions and broader risk-off positioning.',
      category: 'macro',
      source: 'Spectre Intelligence',
      sourceMeta: { icon: 'spectre', color: '#8B5CF6' },
      tickers: [],
      isBreaking: false,
      timestamp: new Date().toISOString(),
    },
    {
      id: 'fb-2',
      headline: 'Federal Reserve Signals Extended Pause on Rate Cuts',
      brief: 'FOMC minutes reveal policymakers concerned about persistent inflation. Stagflation fears mount as energy costs threaten to restrain monetary easing. Treasury yields climb on hawkish repricing.',
      category: 'macro',
      source: 'Spectre Intelligence',
      sourceMeta: { icon: 'spectre', color: '#8B5CF6' },
      tickers: [],
      isBreaking: false,
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-3',
      headline: 'BTC Holds Above Key Support Amid Macro Uncertainty',
      brief: 'Bitcoin maintains position above key moving averages as institutional flows remain steady. Exchange reserves continue declining, suggesting accumulation patterns persist despite broader market volatility.',
      category: 'crypto',
      source: 'Spectre Market Data',
      sourceMeta: { icon: 'spectre', color: '#8B5CF6' },
      tickers: ['BTC'],
      isBreaking: false,
      timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-4',
      headline: 'ETH Staking Yields Draw Institutional Capital',
      brief: 'Ethereum staking deposits reach new highs as yield-seeking institutions allocate to ETH. Growing validator set strengthens network security while reducing circulating supply.',
      category: 'crypto',
      source: 'Spectre On-Chain',
      sourceMeta: { icon: 'spectre', color: '#8B5CF6' },
      tickers: ['ETH'],
      isBreaking: false,
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-5',
      headline: 'Whale Wallets Accumulating SOL on Dips',
      brief: 'Large holder addresses increased Solana positions during the recent pullback. On-chain data shows wallets holding 10K+ SOL added significantly to positions over the past 48 hours.',
      category: 'crypto',
      source: 'Spectre Whale Tracker',
      sourceMeta: { icon: 'spectre', color: '#8B5CF6' },
      tickers: ['SOL'],
      isBreaking: false,
      timestamp: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    },
  ];
}


module.exports = router;
