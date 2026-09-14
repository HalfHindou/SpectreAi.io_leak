/**
 * Spectre Intelligence Hub — OG Image Cache
 * Filesystem cache for generated OG images. 1-hour TTL.
 */
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'content', 'og-cache');
const TTL_MS = 60 * 60 * 1000; // 1 hour

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCachedImage(type, slug) {
  ensureDir();
  const filePath = path.join(CACHE_DIR, `${type}-${slug}.png`);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (Date.now() - stat.mtimeMs > TTL_MS) return null;
  return fs.readFileSync(filePath);
}

function setCachedImage(type, slug, buffer) {
  ensureDir();
  const filePath = path.join(CACHE_DIR, `${type}-${slug}.png`);
  fs.writeFileSync(filePath, buffer);
}

module.exports = { getCachedImage, setCachedImage };
