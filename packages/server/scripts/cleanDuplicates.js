/**
 * One-time script: remove duplicate news articles, keeping the newest unique ones.
 * Uses three dedup methods: word overlap, title similarity, and entity overlap.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'content', 'articles', 'news');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

const articles = files.map(f => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    return {
      file: f,
      headline: data.headline || data.title || '',
      sourceTitle: data.sourceArticle?.title || '',
      publishedAt: data.publishedAt || '',
      isOriginal: data.isOriginal || false,
    };
  } catch (e) { return null; }
}).filter(Boolean);

// Sort by publishedAt (newest first), prefer originals
articles.sort((a, b) => {
  if (a.isOriginal && !b.isOriginal) return -1;
  if (!a.isOriginal && b.isOriginal) return 1;
  return new Date(b.publishedAt) - new Date(a.publishedAt);
});

const STOP = new Set([
  'the','and','for','that','this','with','from','are','was','were','has','have',
  'been','will','can','but','not','its','into','than','may','could','amid','over',
  'after','while','says','new','more','about','just','also','now','here','what',
  'how','why','top','big','key','set','get','hit','hits','eyes','sees','gains',
  'shows','takes','makes','moves','looks','turns','faces','marks','leads','holds',
]);

const ENTITY_KEYWORDS = new Set([
  'bitcoin','btc','ethereum','eth','solana','sol','xrp','cardano','ada','bnb',
  'dogecoin','doge','polygon','matic','avalanche','avax','chainlink','link',
  'coinbase','binance','kraken','robinhood','blackrock','grayscale','microstrategy',
  'sec','fed','cftc','treasury','jpmorgan','goldman','fidelity','vanguard',
  'base','optimism','arbitrum','zksync','starknet','scroll','blast','mantle',
  'uniswap','aave','lido','maker','curve','compound','opensea',
  'tether','usdt','usdc','circle','dai',
]);

function extract(s) {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
  );
}

function wordOverlap(a, b) {
  const wa = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  if (wa.size === 0 || wb.size === 0) return 0;
  let ov = 0;
  for (const w of wa) { if (wb.has(w)) ov++; }
  return ov / Math.min(wa.size, wb.size);
}

function titleSim(a, b) {
  const ka = extract(a);
  const kb = extract(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  let ov = 0;
  for (const w of ka) { if (kb.has(w)) ov++; }
  return ov / Math.max(ka.size, kb.size);
}

function extractEntities(title) {
  const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  return new Set(words.filter(w => ENTITY_KEYWORDS.has(w)));
}

function entityOverlap(a, b) {
  const ea = extractEntities(a);
  const eb = extractEntities(b);
  let ov = 0;
  for (const e of ea) { if (eb.has(e)) ov++; }
  return ov;
}

function isDupOf(headline, existing) {
  if (wordOverlap(headline, existing) >= 0.35) return true;
  const tsim = titleSim(headline, existing);
  if (tsim >= 0.40) return true;
  if (entityOverlap(headline, existing) >= 2 && tsim >= 0.25) return true;
  return false;
}

const keep = [];
const remove = [];

for (const art of articles) {
  // Check against ALL titles of kept articles (headline + source title)
  const isDup = keep.some(k => {
    const kTitles = [k.headline, k.sourceTitle].filter(Boolean);
    const aTitles = [art.headline, art.sourceTitle].filter(Boolean);
    for (const kt of kTitles) {
      for (const at of aTitles) {
        if (isDupOf(at, kt)) return true;
      }
    }
    return false;
  });
  if (isDup) {
    remove.push(art);
  } else {
    keep.push(art);
  }
}

console.log('TOTAL:', articles.length);
console.log('KEEP:', keep.length);
console.log('REMOVE:', remove.length);

console.log('\n--- KEEPING ---');
keep.forEach(k => console.log(` ${k.isOriginal ? '✦' : '·'} ${k.headline.slice(0, 80)}`));

console.log('\n--- REMOVING ---');
remove.forEach(r => console.log(`  ${r.headline.slice(0, 80)}`));

// Delete duplicates
for (const r of remove) {
  fs.unlinkSync(path.join(dir, r.file));
}
console.log('\nDeleted', remove.length, 'duplicate articles');
