/**
 * Spectre Intelligence Hub — SEO Routes
 * Sitemap, robots.txt, RSS feeds, llms.txt, and server-rendered HTML for crawlers.
 */
const express = require('express');
const router = express.Router();
const { listAllPublished, listArticles, loadArticle, BASE_URL } = require('../content/store');

// ── ROBOTS.TXT ──
router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /intelligence/
Allow: /newsroom
Allow: /sitemap.xml
Disallow: /api/
Sitemap: ${BASE_URL}/sitemap.xml
`);
});

// ── SITEMAP.XML ──
let sitemapCache = { data: null, expires: 0 };
router.get('/sitemap.xml', (req, res) => {
  const now = Date.now();
  if (sitemapCache.data && now < sitemapCache.expires) {
    res.type('application/xml');
    return res.send(sitemapCache.data);
  }

  const articles = listAllPublished({ limit: 500 });
  const urls = [
    `  <url><loc>${BASE_URL}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `  <url><loc>${BASE_URL}/intelligence</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>`,
    `  <url><loc>${BASE_URL}/newsroom</loc><changefreq>always</changefreq><priority>0.95</priority></url>`,
  ];

  for (const a of articles) {
    const loc = `${BASE_URL}/intelligence/${a.type}/${a.slug}`;
    const lastmod = (a.updatedAt || a.publishedAt || '').split('T')[0];
    const priority = a.type === 'daily' ? '0.8' : a.type === 'news' ? '0.8' : '0.7';
    const freq = a.type === 'daily' ? 'daily' : a.type === 'news' ? 'hourly' : 'weekly';
    urls.push(`  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  sitemapCache = { data: xml, expires: now + 3600000 }; // 1h cache
  res.type('application/xml');
  res.send(xml);
});

// ── RSS FEEDS ──
function buildRssFeed(title, description, articles) {
  const items = articles.slice(0, 50).map(a => {
    const link = `${BASE_URL}/intelligence/${a.type}/${a.slug}`;
    const pubDate = new Date(a.publishedAt || a.updatedAt).toUTCString();
    return `    <item>
      <title><![CDATA[${a.headline || a.title || ''}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${a.summary || ''}]]></description>
      <category>${a.type}</category>
    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${title}</title>
    <link>${BASE_URL}/intelligence</link>
    <description>${description}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${BASE_URL}/api/rss" rel="self" type="application/rss+xml"/>
    <image>
      <url>${BASE_URL}/spectre-logo.png</url>
      <title>${title}</title>
      <link>${BASE_URL}</link>
    </image>
${items.join('\n')}
  </channel>
</rss>`;
}

router.get('/api/rss', (req, res) => {
  const articles = listAllPublished({ limit: 50 });
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.type('application/rss+xml');
  res.send(buildRssFeed('Spectre Intelligence', 'AI-powered market research by Spectre AI', articles));
});

router.get('/api/rss/daily', (req, res) => {
  const articles = listArticles('daily', { limit: 50 });
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.type('application/rss+xml');
  res.send(buildRssFeed('Spectre Daily Briefs', 'Daily market intelligence by Spectre AI', articles));
});

router.get('/api/rss/crypto', (req, res) => {
  const articles = listArticles('crypto', { limit: 50 });
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.type('application/rss+xml');
  res.send(buildRssFeed('Spectre Crypto Research', 'Crypto token analysis by Spectre AI', articles));
});

router.get('/api/rss/stocks', (req, res) => {
  const articles = listArticles('stocks', { limit: 50 });
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.type('application/rss+xml');
  res.send(buildRssFeed('Spectre Equity Research', 'Stock analysis by Spectre AI', articles));
});

router.get('/api/rss/news', (req, res) => {
  const articles = listArticles('news', { limit: 50 });
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.type('application/rss+xml');
  res.send(buildRssFeed('Spectre News Briefs', '24/7 crypto news by Spectre AI', articles));
});

// ── LLMS.TXT (AISEO) ──
router.get('/llms.txt', (req, res) => {
  res.type('text/plain');
  res.send(`# Spectre AI Intelligence Hub
> AI-powered market research, published daily

## Content Types
- Daily Market Briefs: comprehensive crypto + stock market analysis
- Crypto Token Analysis: in-depth research on 25+ tokens
- Equity Research: analysis of 27+ major stocks
- News Briefs: 24/7 AI-curated crypto news with sentiment analysis
- Thematic Research: cross-market deep dives

## URL Patterns
- Daily Briefs: ${BASE_URL}/intelligence/daily/{YYYY-MM-DD}
- Crypto Analysis: ${BASE_URL}/intelligence/crypto/{token-slug}
- Stock Analysis: ${BASE_URL}/intelligence/stocks/{company-slug}
- News Briefs: ${BASE_URL}/intelligence/news/{story-slug}
- Newsroom: ${BASE_URL}/newsroom

## Update Schedule
- Daily research at 08:00 UTC: 53 articles per cycle (1 daily + 25 crypto + 27 stocks)
- News: 24/7 — curator every 30min, breaking every 10min, daily brief 08:00+16:00 UTC

## Feeds
- All: ${BASE_URL}/api/rss
- Daily: ${BASE_URL}/api/rss/daily
- Crypto: ${BASE_URL}/api/rss/crypto
- Stocks: ${BASE_URL}/api/rss/stocks
- News: ${BASE_URL}/api/rss/news
- Full Index: ${BASE_URL}/llms-full.txt

## About
Published by Spectre AI (${BASE_URL}). Content is AI-generated research for informational purposes.
Not financial advice.
`);
});

router.get('/llms-full.txt', (req, res) => {
  const articles = listAllPublished({ limit: 500 });
  let content = `# Spectre AI Intelligence Hub — Full Content Index\n# Generated: ${new Date().toISOString()}\n# Total Articles: ${articles.length}\n\n`;

  for (const a of articles) {
    const url = `${BASE_URL}/intelligence/${a.type}/${a.slug}`;
    const date = (a.publishedAt || '').split('T')[0];
    const tickers = (a.tickers || []).join(', ');
    content += `## ${a.headline || a.title}\n- URL: ${url}\n- Date: ${date}\n- Type: ${a.type}\n- Tickers: ${tickers}\n- Summary: ${a.summary || ''}\n\n`;
  }

  res.type('text/plain');
  res.send(content);
});

// ── SERVER-RENDERED HTML FOR CRAWLERS ──
router.get('/intelligence/:type/:slug', (req, res, next) => {
  // Only serve HTML if Accept header prefers HTML (crawler/browser) — not JSON API calls
  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) return next();

  const { type, slug } = req.params;
  const article = loadArticle(type, slug);
  if (!article) return next();

  const categoryLabel = type === 'crypto' ? 'CRYPTO ANALYSIS' : type === 'stocks' ? 'EQUITY RESEARCH' : type === 'daily' ? 'DAILY BRIEF' : type === 'news' ? 'NEWS BRIEF' : 'RESEARCH';
  const jsonLd = JSON.stringify(article.jsonLd || {});
  const canonicalUrl = article.canonicalUrl || `${BASE_URL}/intelligence/${type}/${slug}`;

  // Convert markdown to basic HTML
  const bodyHtml = (article.content || '')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\$([A-Z]{1,5})/g, '<span class="ticker">$$1</span>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title}</title>
  <meta name="description" content="${(article.summary || '').slice(0, 155)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${article.headline || article.title}">
  <meta property="og:description" content="${(article.summary || '').slice(0, 155)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${BASE_URL}/og/${type}/${slug}.png">
  <meta property="og:site_name" content="Spectre Intelligence">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${article.headline || article.title}">
  <meta name="twitter:description" content="${(article.summary || '').slice(0, 155)}">
  <meta name="twitter:image" content="${BASE_URL}/og/${type}/${slug}.png">
  <link rel="alternate" type="application/rss+xml" title="Spectre Intelligence" href="${BASE_URL}/api/rss">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    :root { --bg: #07070d; --text: rgba(255,255,255,0.88); --muted: rgba(255,255,255,0.5); --accent: #8B5CF6; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', -apple-system, sans-serif; line-height: 1.7; padding: 48px 24px; max-width: 720px; margin: 0 auto; }
    h1 { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 600; margin-bottom: 8px; }
    h2 { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 600; margin: 32px 0 12px; color: #fff; }
    h3 { font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
    p { margin-bottom: 16px; }
    .category { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-bottom: 12px; }
    .meta { color: var(--muted); font-size: 13px; font-family: 'JetBrains Mono', monospace; margin-bottom: 32px; }
    .ticker { font-family: 'JetBrains Mono', monospace; background: rgba(139,92,246,0.15); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .back { display: inline-block; margin-bottom: 24px; font-size: 13px; color: var(--muted); }
  </style>
</head>
<body>
  <a class="back" href="${BASE_URL}/intelligence">← Back to Intelligence Hub</a>
  <div class="category">${categoryLabel}</div>
  <h1>${article.headline || article.title}</h1>
  <div class="meta">Published ${new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${article.content ? article.content.split(/\s+/).length : 0} words · ${(article.sourcesCited || []).length} sources</div>
  <article><p>${bodyHtml}</p></article>
  <hr style="margin: 48px 0 24px; border: none; border-top: 1px solid rgba(255,255,255,0.08);">
  <p style="font-size: 13px; color: var(--muted);">Published by <a href="${BASE_URL}">Spectre AI</a>. AI-generated research for informational purposes only. Not financial advice.</p>
</body>
</html>`;

  res.type('text/html');
  res.send(html);
});

module.exports = router;
