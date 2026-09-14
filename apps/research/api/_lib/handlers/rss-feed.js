/**
 * Vercel Serverless -- RSS feed endpoint.
 * The content store (file-based articles) is not available on Vercel, so we
 * return a structurally valid but empty RSS 2.0 feed for each type.
 *
 * Routing: vercel.json rewrites /api/rss and /api/rss/:type to
 *   /api/rss-feed?type=<type>
 */

const BASE_URL = 'https://spectre-app-research.vercel.app';

const FEED_META = {
  daily:  { title: 'Spectre Daily Briefs',    description: 'Daily market intelligence by Spectre AI' },
  crypto: { title: 'Spectre Crypto Research',  description: 'Crypto token analysis by Spectre AI' },
  stocks: { title: 'Spectre Equity Research',  description: 'Stock analysis by Spectre AI' },
  news:   { title: 'Spectre News Briefs',      description: '24/7 crypto news by Spectre AI' },
};

const DEFAULT_META = {
  title: 'Spectre Intelligence',
  description: 'AI-powered market research by Spectre AI',
};

function buildRssFeed(title, description, feedType) {
  const selfHref = feedType
    ? `${BASE_URL}/api/rss/${feedType}`
    : `${BASE_URL}/api/rss`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${title}</title>
    <link>${BASE_URL}/intelligence</link>
    <description>${description}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${selfHref}" rel="self" type="application/rss+xml"/>
    <image>
      <url>${BASE_URL}/spectre-logo.png</url>
      <title>${title}</title>
      <link>${BASE_URL}</link>
    </image>
  </channel>
</rss>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');

  const feedType = (req.query.type || '').toLowerCase() || null;
  const meta = (feedType && FEED_META[feedType]) || DEFAULT_META;

  return res.status(200).send(buildRssFeed(meta.title, meta.description, feedType));
}
