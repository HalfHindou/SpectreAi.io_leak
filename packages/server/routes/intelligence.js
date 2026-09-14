/**
 * Spectre Intelligence Hub — API Routes
 * Content serving, activity feed, stats, and generation triggers.
 */
const express = require('express');
const router = express.Router();
const { loadArticle, listArticles, listAllPublished, listNews, getFeatured, getBreaking, getLatestDailyBrief, getStats } = require('../content/store');
const { getActivityLog } = require('../agents/activityLog');
const { runFullGeneration, generateSingle, runCuratorCycle, runBreakingCheck, runAnalysisCycle, runResearchCycle } = require('../agents/scheduler');

const ADMIN_KEY = process.env.ADMIN_KEY || process.env.SPECTRE_POSTING_API_KEY || '';

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.admin_key || '';
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/intelligence — all published articles
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const articles = listAllPublished({ limit });
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    count: articles.length,
    articles: articles.map(summarize),
  });
});

// GET /api/intelligence/activity — agent activity log
router.get('/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const log = getActivityLog(limit);
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({ count: log.length, events: log });
});

// GET /api/intelligence/stats — hub stats
router.get('/stats', (req, res) => {
  const stats = getStats();
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(stats);
});

// POST /api/intelligence/generate — trigger full generation (admin)
router.post('/generate', requireAdmin, async (req, res) => {
  res.json({ status: 'started', message: 'Full generation triggered. This will take 5-8 minutes.' });
  // Run async — don't block response
  runFullGeneration().then(result => {
    console.log('[intelligence] Full generation result:', JSON.stringify(result));
  }).catch(err => {
    console.error('[intelligence] Full generation error:', err.message);
  });
});

// POST /api/intelligence/generate/:type/:symbol — trigger single (admin)
router.post('/generate/:type/:symbol', requireAdmin, async (req, res) => {
  const { type, symbol } = req.params;
  try {
    const article = await generateSingle(type, symbol);
    if (article) {
      res.json({ status: 'completed', article: summarize(article) });
    } else {
      res.status(500).json({ status: 'failed', error: 'Generation returned null' });
    }
  } catch (e) {
    res.status(500).json({ status: 'failed', error: e.message });
  }
});

// GET /api/intelligence/news — news articles with filters
router.get('/news', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 15, 100);
  const category = req.query.category || undefined;
  const breakingOnly = req.query.breaking === 'true';
  const featuredOnly = req.query.featured === 'true';
  const articles = listNews({ limit, category, breakingOnly, featuredOnly });
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    count: articles.length,
    articles: articles.map(summarizeNews),
  });
});

// GET /api/intelligence/featured — featured articles
router.get('/featured', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  const articles = getFeatured(limit);
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    count: articles.length,
    articles: articles.map(summarizeNews),
  });
});

// GET /api/intelligence/breaking — active breaking news
router.get('/breaking', (req, res) => {
  const articles = getBreaking();
  res.setHeader('Cache-Control', 'public, max-age=15');
  res.json({
    count: articles.length,
    articles: articles.map(summarizeNews),
  });
});

// GET /api/intelligence/daily/latest — most recent daily brief
router.get('/daily/latest', (req, res) => {
  const brief = getLatestDailyBrief();
  if (!brief) return res.status(404).json({ error: 'No daily brief found' });
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(brief);
});

// POST /api/intelligence/newsroom/trigger — trigger curator cycle (admin)
router.post('/newsroom/trigger', requireAdmin, async (req, res) => {
  res.json({ status: 'started', message: 'Curator + Analysis cycle triggered.' });
  runCuratorCycle().then(result => {
    console.log('[intelligence] Curator cycle result:', JSON.stringify(result));
  }).catch(err => {
    console.error('[intelligence] Curator cycle error:', err.message);
  });
  // Also trigger analysis cycle for original Spectre AI articles
  runAnalysisCycle().then(result => {
    console.log('[intelligence] Analysis cycle result:', JSON.stringify(result));
  }).catch(err => {
    console.error('[intelligence] Analysis cycle error:', err.message);
  });
});

// POST /api/intelligence/breaking/trigger — trigger breaking news check + article generation (admin)
router.post('/breaking/trigger', requireAdmin, async (req, res) => {
  res.json({ status: 'started', message: 'Breaking news check triggered.' });
  runBreakingCheck().then(result => {
    console.log('[intelligence] Breaking check result:', JSON.stringify(result));
  }).catch(err => {
    console.error('[intelligence] Breaking check error:', err.message);
  });
});

// POST /api/intelligence/research/trigger — trigger research article (admin)
router.post('/research/trigger', requireAdmin, async (req, res) => {
  res.json({ status: 'started', message: 'Research article generation triggered.' });
  runResearchCycle().then(result => {
    console.log('[intelligence] Research cycle result:', JSON.stringify(result));
  }).catch(err => {
    console.error('[intelligence] Research cycle error:', err.message);
  });
});

// GET /api/intelligence/:type — articles by type
// Must come after /activity, /stats, /generate, /news, /featured, /breaking, /research to avoid conflicts
router.get('/:type', (req, res) => {
  const { type } = req.params;
  // Guard against matching reserved routes
  if (['activity', 'stats', 'generate', 'news', 'featured', 'breaking', 'newsroom'].includes(type)) return;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const articles = listArticles(type, { limit });
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    count: articles.length,
    articles: articles.map(summarize),
  });
});

// GET /api/intelligence/:type/:slug — single article JSON
router.get('/:type/:slug', (req, res) => {
  const { type, slug } = req.params;
  const article = loadArticle(type, slug);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.json(article);
});

/** Strip heavy fields for list views */
function summarize(article) {
  return {
    slug: article.slug,
    type: article.type,
    title: article.title,
    headline: article.headline,
    summary: article.summary,
    tickers: article.tickers,
    categories: article.categories,
    tags: article.tags,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    dataSnapshot: article.dataSnapshot,
    wordCount: article.content ? article.content.split(/\s+/).length : 0,
    sourceCount: (article.sourcesCited || []).length,
    isOriginal: article.isOriginal || false,
    coverImage: article.coverImage || article.sourceArticle?.imageUrl || null,
    ogImage: article.ogImage
      ? `/og/${article.type}/${article.slug}.png`
      : null,
  };
}

/** News-specific summary with sentiment/breaking/source fields */
function summarizeNews(article) {
  // Build a richer content preview: strip markdown + headline echo, take first ~500 chars
  let contentPreview = '';
  if (article.content) {
    let cleaned = article.content
      .replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '')
      .replace(/\n+/g, ' ').trim();
    // Remove headline echo from the start
    const hl = (article.headline || article.title || '').replace(/\*\*/g, '').replace(/\*/g, '');
    if (hl && cleaned.startsWith(hl)) cleaned = cleaned.slice(hl.length).trim();
    contentPreview = cleaned.slice(0, 500);
  }
  return {
    ...summarize(article),
    contentPreview: contentPreview || null,
    sentiment: article.sentiment || null,
    sentimentScore: article.sentimentScore || null,
    category: article.category || null,
    isBreaking: article.isBreaking || false,
    isFeatured: article.isFeatured || false,
    sourceArticle: article.sourceArticle || null,
    expiresAt: article.expiresAt || null,
  };
}

module.exports = router;
