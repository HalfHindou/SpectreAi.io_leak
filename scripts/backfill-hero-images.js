#!/usr/bin/env node
/**
 * Backfill hero images for existing articles in The Spectre Edition content store.
 *
 * Walks every article JSON under packages/server/content/articles/ and, for any
 * article missing `coverImage`, runs the normal image generator (Unsplash →
 * Stability → DALL-E → SVG fallback) and writes the path back onto the article.
 *
 * Usage:
 *   node scripts/backfill-hero-images.js           # backfill missing only
 *   node scripts/backfill-hero-images.js --force   # regenerate even if present
 *   node scripts/backfill-hero-images.js --type news
 */
const fs = require('fs');
const path = require('path');

// Load .env so UNSPLASH_ACCESS_KEY / STABILITY_API_KEY / OPENAI_API_KEY are available
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* dotenv optional */ }

const { generateArticleImage } = require('../packages/server/agents/imageGenerator');

const ARTICLES_DIR = path.join(__dirname, '..', 'packages', 'server', 'content', 'articles');
const TYPES = ['news', 'research', 'daily', 'crypto', 'stocks', 'calendar'];

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY_TYPE = (() => {
  const i = args.indexOf('--type');
  return i >= 0 ? args[i + 1] : null;
})();

function listArticleFiles(type) {
  const dir = path.join(ARTICLES_DIR, type);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
}

async function main() {
  const startedAt = Date.now();
  const types = ONLY_TYPE ? [ONLY_TYPE] : TYPES;
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let updated = 0;

  for (const type of types) {
    const files = listArticleFiles(type);
    console.log(`\n[backfill] ${type}: ${files.length} article(s)`);

    for (const file of files) {
      let article;
      try {
        article = JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch (e) {
        console.warn(`[backfill] skip ${path.basename(file)} (unreadable): ${e.message}`);
        failed++;
        continue;
      }

      if (!article?.slug || !article?.type) {
        skipped++;
        continue;
      }
      if (article.coverImage && !FORCE) {
        skipped++;
        continue;
      }

      try {
        const result = await generateArticleImage(article);
        if (result) {
          console.log(`  [OK]  ${article.slug} → ${result}`);
          updated++;
        } else {
          console.warn(`  [--]  ${article.slug} (generator returned null)`);
        }
      } catch (e) {
        console.error(`  [ERR] ${article.slug}: ${e.message}`);
        failed++;
      }
      processed++;

      // Throttle so Unsplash 50/hr doesn't blow up (~900ms/req = 67 req/min max burst)
      await new Promise(r => setTimeout(r, 900));
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[backfill] done — processed=${processed} updated=${updated} skipped=${skipped} failed=${failed} in ${elapsed}s`);
}

main().catch(err => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
