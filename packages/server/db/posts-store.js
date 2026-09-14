/**
 * Spectre Posting API – minimal persistence for posts
 * In-memory + optional JSON file. Can be swapped for SQLite (same interface).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SPECTRE_POSTS_DATA_DIR || path.join(__dirname, '..', 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');

let posts = new Map();
let nextId = 1;

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function load() {
  try {
    ensureDir(DATA_DIR);
    const raw = fs.readFileSync(POSTS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    posts.clear();
    arr.forEach((p) => {
      posts.set(p.id, p);
      const n = parseInt(p.id.replace(/\D/g, ''), 10);
      if (!isNaN(n) && n >= nextId) nextId = n + 1;
    });
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[posts-store] load error:', e.message);
  }
}

function save() {
  try {
    ensureDir(DATA_DIR);
    const arr = Array.from(posts.values());
    fs.writeFileSync(POSTS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    console.error('[posts-store] save error:', e.message);
  }
}

load();

function generateId() {
  const id = `post_${nextId++}`;
  return id;
}

/**
 * @param {object} post - { id, post_text, status, metadata, created_at }
 */
function createPost(post) {
  const id = post.id || generateId();
  const record = {
    id,
    post_text: post.post_text || '',
    status: post.status || 'published',
    metadata: post.metadata || {},
    created_at: post.created_at || new Date().toISOString(),
  };
  posts.set(id, record);
  save();
  return record;
}

/**
 * @param {string} id
 */
function getPostById(id) {
  return posts.get(id) || null;
}

module.exports = {
  createPost,
  getPostById,
  load,
  save,
};
