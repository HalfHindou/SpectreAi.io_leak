#!/usr/bin/env node
/**
 * Build-time bundler for Intelligence Hub content.
 * Reads every article JSON from packages/server/content/articles/<type>/*.json
 * and writes a single consolidated bundle that the Vercel serverless handler
 * imports at cold-start.
 *
 * Output: apps/research/api/_data/intelligence-data.json
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..', '..')
const ARTICLES_DIR = join(ROOT, 'packages', 'server', 'content', 'articles')
const OUT_DIR = resolve(__dirname, '..', 'api', '_data')
const OUT_FILE = join(OUT_DIR, 'intelligence-data.json')

const TYPES = ['daily', 'crypto', 'stocks', 'research', 'news', 'calendar']

function readArticlesForType(type) {
  const dir = join(ARTICLES_DIR, type)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  const articles = []
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf-8')
      const data = JSON.parse(raw)
      if (data && data.status !== 'draft') articles.push(data)
    } catch (e) {
      console.warn(`[intelligence-content] skip ${type}/${f}: ${e.message}`)
    }
  }
  articles.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
  return articles
}

function build() {
  if (!existsSync(ARTICLES_DIR)) {
    console.warn(`[intelligence-content] articles dir missing at ${ARTICLES_DIR} — writing empty bundle`)
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
    const empty = TYPES.reduce((acc, t) => { acc[t] = []; return acc }, {})
    writeFileSync(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), articles: empty }))
    return
  }

  const articles = {}
  let total = 0
  for (const type of TYPES) {
    const list = readArticlesForType(type)
    articles[type] = list
    total += list.length
    console.log(`[intelligence-content] ${type}: ${list.length}`)
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const payload = { generatedAt: new Date().toISOString(), articles }
  writeFileSync(OUT_FILE, JSON.stringify(payload))

  const size = statSync(OUT_FILE).size
  console.log(`[intelligence-content] wrote ${total} articles -> ${OUT_FILE} (${(size / 1024 / 1024).toFixed(2)} MB)`)
}

build()
