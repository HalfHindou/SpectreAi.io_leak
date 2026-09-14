/**
 * CMS Routes — Read/write website content JSON
 * GET  /api/cms/website  — public, returns content (15s cache)
 * PUT  /api/cms/website  — admin-only, saves content
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const CONTENT_PATH = path.join(__dirname, '..', 'content', 'website-content.json');

// In-memory cache
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 15_000; // 15s

function readContent() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return cache;
  try {
    const raw = fs.readFileSync(CONTENT_PATH, 'utf8');
    cache = JSON.parse(raw);
    cacheTime = now;
    return cache;
  } catch {
    return {};
  }
}

function writeContent(data) {
  const dir = path.dirname(CONTENT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONTENT_PATH, JSON.stringify(data, null, 2), 'utf8');
  cache = data;
  cacheTime = Date.now();
}

// Admin auth middleware
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(500).json({ error: 'ADMIN_KEY not configured' });
  const provided = req.headers['x-admin-key'];
  if (provided !== adminKey) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// GET /api/cms/website — public
router.get('/website', (req, res) => {
  res.json(readContent());
});

// PUT /api/cms/website — admin only
router.put('/website', requireAdmin, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object' });
  }
  writeContent(data);
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

// POST /api/cms/auth — verify admin key
router.post('/auth', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(500).json({ error: 'ADMIN_KEY not configured' });
  const { key } = req.body || {};
  if (key === adminKey) {
    res.json({ authenticated: true });
  } else {
    res.status(403).json({ authenticated: false });
  }
});

module.exports = router;
