/**
 * Spectre Posting API – generate and publish crypto content
 * POST /v1/posts (publish), POST /v1/posts/dry-run (generate only), GET /v1/posts/:id, GET /v1/health
 * Auth: Bearer token or X-API-Key. Logging, validation, rate limit handling.
 */

const express = require('express');
const router = express.Router();
const postsStore = require('../db/posts-store');

const API_KEY = process.env.SPECTRE_POSTING_API_KEY || process.env.SPECTRE_API_KEY || '';
if (!API_KEY) console.warn('[spectre-posting] SPECTRE_POSTING_API_KEY/SPECTRE_API_KEY not set - posting routes will return 503');
const RATE_LIMIT_PER_MIN = parseInt(process.env.SPECTRE_POSTING_RATE_LIMIT_PER_MIN || '60', 10);

const rateCounts = new Map();
function checkRateLimit(key) {
  const now = Date.now();
  const windowStart = now - 60 * 1000;
  let list = rateCounts.get(key) || [];
  list = list.filter((t) => t > windowStart);
  if (list.length >= RATE_LIMIT_PER_MIN) return false;
  list.push(now);
  rateCounts.set(key, list);
  return true;
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'];
  if (!API_KEY) {
    logRequest(req, 503, { error: 'Posting API not configured' });
    return res.status(503).json({ success: false, error: 'Posting API not configured' });
  }
  if (!token || token !== API_KEY) {
    logRequest(req, 401, { error: 'Invalid or missing API key' });
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  req.postingAuth = token;
  next();
}

function requestId(req) {
  return req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function logRequest(req, statusCode, body) {
  const id = requestId(req);
  const method = req.method;
  const path = req.path;
  const ts = new Date().toISOString();
  console.log(`[spectre-posting] ${ts} ${id} ${method} ${path} ${statusCode}`);
  if (body && body.error) console.log(`[spectre-posting] ${id} error: ${body.error}`);
}

function validatePostBody(body) {
  if (!body || typeof body !== 'object') return { valid: false, error: 'Body must be a JSON object' };
  const topic = body.topic;
  if (!topic || typeof topic !== 'string' || !topic.trim()) return { valid: false, error: 'topic is required and must be a non-empty string' };
  if (topic.length > 500) return { valid: false, error: 'topic must be at most 500 characters' };
  const format = body.format;
  if (format && !['twitter', 'telegram', 'headline'].includes(format)) return { valid: false, error: 'format must be twitter, telegram, or headline' };
  return { valid: true };
}

/**
 * Generate post text from topic/tickers/constraints (no LLM – template-based so it works without keys).
 * In production you can replace this with a call to Claude/OpenAI.
 */
function generatePostText(body) {
  const topic = (body.topic || '').trim();
  const tickers = Array.isArray(body.tickers) ? body.tickers.filter((t) => t && String(t).trim()) : [];
  const format = body.format || 'twitter';
  const disclaimers = (body.disclaimers || '').trim();
  const constraints = body.constraints || {};
  const noOverpromises = constraints.no_overpromises !== false;

  const tickerStr = tickers.length ? ` ${tickers.join(', ')}.` : '';
  let text = '';
  if (format === 'headline') {
    text = `${topic}.${tickerStr}`.replace(/\.+$/, '.');
  } else if (format === 'telegram') {
    text = `📌 ${topic}${tickerStr}\n\nWatching levels; next 24h will tell.${noOverpromises ? ' NFA.' : ''}`;
  } else {
    text = `${topic}${tickerStr} Level to watch; next 24h will tell.${noOverpromises ? ' NFA.' : ''}${disclaimers ? ` ${disclaimers}` : ''}`;
  }
  text = text.trim().slice(0, 280);
  return text;
}

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'spectre-posting' });
});

router.post('/posts/dry-run', authMiddleware, (req, res) => {
  const reqId = requestId(req);
  if (API_KEY && !req.postingAuth) {
    logRequest(req, 401, { error: 'Unauthorized' });
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  if (API_KEY && !checkRateLimit(req.postingAuth)) {
    logRequest(req, 429, { error: 'Rate limit exceeded' });
    return res.status(429).set('Retry-After', 60).json({ success: false, error: 'Rate limit exceeded' });
  }

  const validation = validatePostBody(req.body);
  if (!validation.valid) {
    logRequest(req, 400, { error: validation.error });
    return res.status(400).json({ success: false, error: validation.error });
  }

  try {
    const postText = generatePostText(req.body);
    const metadata = {
      topic: req.body.topic,
      tickers: req.body.tickers || [],
      format: req.body.format || 'twitter',
      timestamp: new Date().toISOString(),
    };
    const response = {
      success: true,
      post_text: postText,
      metadata,
      post_id: null,
      timestamp: new Date().toISOString(),
    };
    logRequest(req, 200);
    res.json(response);
  } catch (e) {
    console.error(`[spectre-posting] ${reqId} dry-run error:`, e);
    logRequest(req, 500, { error: e.message });
    res.status(500).json({ success: false, error: e.message, timestamp: new Date().toISOString() });
  }
});

router.post('/posts', authMiddleware, (req, res) => {
  const reqId = requestId(req);
  if (API_KEY && !req.postingAuth) {
    logRequest(req, 401, { error: 'Unauthorized' });
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  if (API_KEY && !checkRateLimit(req.postingAuth)) {
    logRequest(req, 429, { error: 'Rate limit exceeded' });
    return res.status(429).set('Retry-After', 60).json({ success: false, error: 'Rate limit exceeded' });
  }

  const validation = validatePostBody(req.body);
  if (!validation.valid) {
    logRequest(req, 400, { error: validation.error });
    return res.status(400).json({ success: false, error: validation.error });
  }

  try {
    const postText = generatePostText(req.body);
    const metadata = {
      topic: req.body.topic,
      tickers: req.body.tickers || [],
      format: req.body.format || 'twitter',
      timestamp: new Date().toISOString(),
    };
    const record = postsStore.createPost({
      post_text: postText,
      status: 'published',
      metadata,
    });
    const response = {
      success: true,
      post_text: postText,
      metadata,
      post_id: record.id,
      timestamp: new Date().toISOString(),
    };
    logRequest(req, 201);
    res.status(201).json(response);
  } catch (e) {
    console.error(`[spectre-posting] ${reqId} post error:`, e);
    logRequest(req, 500, { error: e.message });
    res.status(500).json({ success: false, error: e.message, timestamp: new Date().toISOString() });
  }
});

router.get('/posts/:id', authMiddleware, (req, res) => {
  if (API_KEY && !req.postingAuth) {
    logRequest(req, 401, { error: 'Unauthorized' });
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }

  const post = postsStore.getPostById(req.params.id);
  if (!post) {
    logRequest(req, 404, { error: 'Post not found' });
    return res.status(404).json({ success: false, error: 'Post not found' });
  }
  logRequest(req, 200);
  res.json({
    id: post.id,
    status: post.status,
    post_text: post.post_text,
    created_at: post.created_at,
  });
});

module.exports = router;
