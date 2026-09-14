/**
 * Spectre Intelligence — AI Image Generator
 * Generates hero images for articles using:
 *   1. Unsplash curated photos (FREE, if UNSPLASH_ACCESS_KEY set) — real editorial photography
 *   2. Stability AI (cheapest AI, if STABILITY_API_KEY set)
 *   3. DALL-E 3 via OpenAI (higher quality, if OPENAI_API_KEY set)
 *   4. SVG fallback (zero cost, always works — branded Spectre template)
 *
 * After successful generation the image path is written back onto the article's
 * JSON as `coverImage` so the frontend can render it without the `/api/hero/:slug`
 * round-trip.
 *
 * Images saved to packages/server/content/og-cache/{slug}.{png|svg|jpg}
 * Served via GET /api/og/{slug} or GET /api/hero/{slug}
 */
const fs = require('fs');
const path = require('path');

const OG_DIR = path.join(__dirname, '..', 'content', 'og-cache');
const ARTICLES_DIR = path.join(__dirname, '..', 'content', 'articles');

// Ensure directory exists
if (!fs.existsSync(OG_DIR)) {
  fs.mkdirSync(OG_DIR, { recursive: true });
}

// ── TOKEN VISUAL MAP — visual descriptions for AI image prompts ──
const TOKEN_VISUALS = {
  BTC: { visual: 'glowing golden bitcoin symbol, digital gold, flowing data streams', color: '#F7931A', accent: '#FFD700' },
  ETH: { visual: 'silver ethereum diamond crystal, hexagonal geometry, ethereal glow', color: '#627EEA', accent: '#8B9DFF' },
  SOL: { visual: 'purple solar energy, high-speed particle trails, dynamic motion blur', color: '#00FFA3', accent: '#9945FF' },
  BNB: { visual: 'golden chain links, web3 node network, warm amber glow', color: '#F3BA2F', accent: '#FFD36B' },
  XRP: { visual: 'blue ripple waves, financial network mesh, liquid light', color: '#23292F', accent: '#00AAE4' },
  DOGE: { visual: 'playful shiba inu silhouette, meme energy, golden particle burst', color: '#C2A633', accent: '#FFE47A' },
  ADA: { visual: 'blue cardano geometry, scientific lattice, deep ocean tones', color: '#0033AD', accent: '#3366FF' },
  AVAX: { visual: 'red avalanche triangle, snowy peak, crystal red energy', color: '#E84142', accent: '#FF6B6B' },
  LINK: { visual: 'blue chainlink hexagons, oracle data bridges, interconnected nodes', color: '#2A5ADA', accent: '#5B8DEF' },
  DOT: { visual: 'polkadot circles, multichain relay, colorful node connections', color: '#E6007A', accent: '#FF4DA6' },
  UNI: { visual: 'pink unicorn horn silhouette, DeFi liquidity pools, swirling energy', color: '#FF007A', accent: '#FF66B2' },
  LTC: { visual: 'silver litecoin, digital silver bar, fast lightning streaks', color: '#BFBBBB', accent: '#E0E0E0' },
  SHIB: { visual: 'golden shiba inu, meme coin energy, glowing particle swarm', color: '#FFA409', accent: '#FFCC66' },
  ARB: { visual: 'blue arbitrum bridge, L2 scaling layers, orbital rings', color: '#28A0F0', accent: '#5CB8F5' },
  OP: { visual: 'red optimism flame, L2 superchain, optimistic rollup visualization', color: '#FF0420', accent: '#FF5C6C' },
  PEPE: { visual: 'green frog silhouette, meme energy, neon green particle burst', color: '#3C9F3C', accent: '#6BD66B' },
  AAVE: { visual: 'purple ghost shape, DeFi lending protocols, floating orbs', color: '#B6509E', accent: '#D17EC6' },
  MKR: { visual: 'dark green maker vault, stablecoin mechanism, structured finance', color: '#1AAB9B', accent: '#2CDBCA' },
  RENDER: { visual: 'GPU rendering mesh, 3D compute nodes, golden light beams', color: '#FFCB21', accent: '#FFE066' },
  INJ: { visual: 'teal injective syringe, derivatives trading, cosmic exchange', color: '#17EAE5', accent: '#5CEEED' },
  SUI: { visual: 'blue water drops, Move language geometry, pacific blue tones', color: '#6FBCF0', accent: '#99D2F5' },
  APT: { visual: 'green aptos cube, parallel execution threads, emerald crystals', color: '#2ED8A3', accent: '#66E5BF' },
  TIA: { visual: 'purple celestia cosmos, modular blockchain layers, starfield', color: '#7B2FBE', accent: '#A66EE0' },
  SEI: { visual: 'orange sei wave, trading orderbook, fast execution lines', color: '#9B1B30', accent: '#D44A63' },
  BONK: { visual: 'golden dog bone, Solana meme energy, playful particles', color: '#F2A900', accent: '#FFCC33' },
};

// ── Category-based fallback visuals ──
const CATEGORY_VISUALS = {
  defi: { visual: 'DeFi protocol visualization, liquidity pools, yield farming', color: '#06B6D4', accent: '#3DD9EC' },
  nft: { visual: 'digital art gallery, NFT showcase, colorful abstract', color: '#EC4899', accent: '#F472B6' },
  meme: { visual: 'internet meme energy, viral particle explosion, playful chaos', color: '#F59E0B', accent: '#FCD34D' },
  layer2: { visual: 'L2 scaling bridges, rollup compression, orbital layers', color: '#3B82F6', accent: '#60A5FA' },
  ai: { visual: 'neural network brain, AI compute mesh, glowing synapses', color: '#8B5CF6', accent: '#A78BFA' },
  rwa: { visual: 'real-world assets, tokenized bonds, institutional finance', color: '#10B981', accent: '#34D399' },
  gaming: { visual: 'gaming controller, Web3 game world, neon retro', color: '#EF4444', accent: '#F87171' },
  default: { visual: 'abstract cryptocurrency visualization, blockchain nodes', color: '#8B5CF6', accent: '#A78BFA' },
};

const BASE_STYLE = 'dark cinematic, deep space background, purple and blue tones, volumetric light, photorealistic, 8k, premium financial visualization';
const NEGATIVE_PROMPT = 'text, watermark, logo, chart, ui, interface, bright colors, white background, low quality, blurry, distorted';

// ── UNSPLASH QUERY MAP — category/ticker → editorial photo search terms ──
const UNSPLASH_QUERY_BY_CATEGORY = {
  bitcoin: 'bitcoin cryptocurrency digital currency',
  ethereum: 'ethereum blockchain network abstract',
  defi: 'decentralized finance fintech abstract',
  nft: 'digital art nft gallery abstract',
  meme: 'neon lights crypto abstract',
  layer2: 'blockchain network abstract glow',
  ai: 'artificial intelligence neural network dark',
  rwa: 'finance skyscraper institutional',
  gaming: 'gaming controller neon dark',
  regulation: 'government building law capitol',
  regulatory: 'courthouse justice regulation',
  macro: 'federal reserve economy finance',
  stocks: 'stock market wall street dark',
  default: 'cryptocurrency blockchain technology dark abstract',
};

const UNSPLASH_QUERY_BY_TICKER = {
  BTC: 'bitcoin gold cryptocurrency',
  ETH: 'ethereum blockchain abstract purple',
  SOL: 'solar energy abstract purple',
  BNB: 'gold chain network',
  XRP: 'blue water ripple abstract',
  DOGE: 'golden dog abstract',
  SHIB: 'golden dog crypto',
  PEPE: 'green neon abstract',
  ADA: 'blue geometric lattice',
  AVAX: 'red mountain snow abstract',
  DOT: 'colorful dots network abstract',
  LINK: 'blue chain network abstract',
  UNI: 'pink neon abstract',
  ARB: 'blue bridge abstract',
  OP: 'red flame abstract',
  AAVE: 'purple ghost abstract',
  RENDER: 'gpu computing abstract',
  SUI: 'blue water drop abstract',
  APT: 'green crystal cube',
  TIA: 'purple cosmos starfield',
  INJ: 'teal exchange abstract',
  TRUMP: 'washington dc capitol',
};

// ── CURATED UNSPLASH CDN URLS — no API key needed ──
// These are direct photo URLs from images.unsplash.com (public CDN).
// Each URL is a real editorial photograph, not the deprecated source.unsplash.com service.
// Rotation arrays so repeat articles in the same category get variety.
// ?w=1600&h=900&fit=crop&q=80&auto=format = 16:9 hero dimensions, quality 80, auto webp/avif
const UNSPLASH_CDN_PARAMS = '?w=1600&h=900&fit=crop&q=80&auto=format';

const UNSPLASH_CDN_BY_TICKER = {
  BTC: [
    'https://images.unsplash.com/photo-1518546305927-5a555bb7020d', // gold bitcoin stack
    'https://images.unsplash.com/photo-1516245834210-c4c142787335', // bitcoin coins dark
    'https://images.unsplash.com/photo-1621761191319-c6fb62004040', // bitcoin physical
    'https://images.unsplash.com/photo-1543699565-003b8adda5fc', // bitcoin coin macro
  ],
  ETH: [
    'https://images.unsplash.com/photo-1621416894569-0f39ed31d247', // ethereum purple
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0', // eth crystal dark
    'https://images.unsplash.com/photo-1622630998477-20aa696ecb05', // ethereum chain
  ],
  SOL: [
    'https://images.unsplash.com/photo-1519608487953-e999c86e7455', // purple abstract
    'https://images.unsplash.com/photo-1639322537228-f710d846310a', // solana vibes
  ],
  BNB: [
    'https://images.unsplash.com/photo-1621761191319-c6fb62004040', // gold crypto
  ],
  XRP: [
    'https://images.unsplash.com/photo-1639322537504-6427a16b0a28', // blue ripple water
  ],
  DOGE: [
    'https://images.unsplash.com/photo-1558788353-f76d92427f16', // shiba inu
    'https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48', // dog
  ],
  SHIB: [
    'https://images.unsplash.com/photo-1558788353-f76d92427f16', // shiba inu
    'https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48', // dog
  ],
  PEPE: [
    'https://images.unsplash.com/photo-1552072092-7f9b8d63efcb', // green abstract
  ],
  ADA: [
    'https://images.unsplash.com/photo-1639322537228-f710d846310a', // blue geometric
  ],
  AVAX: [
    'https://images.unsplash.com/photo-1511497584788-876760111969', // red snow mountain
    'https://images.unsplash.com/photo-1454496522488-7a8e488e8606', // avalanche peak
  ],
  DOT: [
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0', // network nodes
  ],
  LINK: [
    'https://images.unsplash.com/photo-1639762681057-408e52192e55', // chain links abstract
  ],
  UNI: [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe', // pink neon
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc', // pink abstract
  ],
  ARB: [
    'https://images.unsplash.com/photo-1551288049-bebda4e38f71', // blue bridge
  ],
  OP: [
    'https://images.unsplash.com/photo-1492496913980-501348b61469', // red flame
  ],
  AAVE: [
    'https://images.unsplash.com/photo-1635776062127-d379bfcba9f8', // purple abstract
  ],
  RENDER: [
    'https://images.unsplash.com/photo-1551808525-51a94da548ce', // gpu compute
    'https://images.unsplash.com/photo-1587202372775-e229f172b9d7', // server rack glow
  ],
  SUI: [
    'https://images.unsplash.com/photo-1505142468610-359e7d316be0', // water drop blue
  ],
  APT: [
    'https://images.unsplash.com/photo-1518364538800-6bae3c2ea0f2', // green crystal
  ],
  TIA: [
    'https://images.unsplash.com/photo-1462332420958-a05d1e002413', // starfield cosmos
    'https://images.unsplash.com/photo-1506318137071-a8e063b4bec0', // galaxy purple
  ],
  INJ: [
    'https://images.unsplash.com/photo-1639322537228-f710d846310a', // teal abstract
  ],
  TRUMP: [
    'https://images.unsplash.com/photo-1555848962-6e79363ec58f', // US capitol
    'https://images.unsplash.com/photo-1582719471384-894fbb16e074', // washington
    'https://images.unsplash.com/photo-1617391258031-f8d80b22fb35', // govt building
  ],
  SEI: [
    'https://images.unsplash.com/photo-1639322537228-f710d846310a', // orange wave
  ],
  TAO: [
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485', // AI neural
  ],
  FET: [
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485', // AI neural
  ],
};

const UNSPLASH_CDN_BY_CATEGORY = {
  bitcoin: [
    'https://images.unsplash.com/photo-1518546305927-5a555bb7020d',
    'https://images.unsplash.com/photo-1516245834210-c4c142787335',
    'https://images.unsplash.com/photo-1621761191319-c6fb62004040',
  ],
  ethereum: [
    'https://images.unsplash.com/photo-1621416894569-0f39ed31d247',
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
  ],
  defi: [
    'https://images.unsplash.com/photo-1639322537504-6427a16b0a28', // blue abstract
    'https://images.unsplash.com/photo-1642543492481-44e81e3914a7', // fintech abstract
    'https://images.unsplash.com/photo-1639762681057-408e52192e55', // chain glow
  ],
  nft: [
    'https://images.unsplash.com/photo-1618172193763-c511deb635ca', // digital art
    'https://images.unsplash.com/photo-1614854262318-831574f15f1f', // gallery lights
  ],
  meme: [
    'https://images.unsplash.com/photo-1617791160588-241658c0f566', // neon lights
  ],
  layer2: [
    'https://images.unsplash.com/photo-1551288049-bebda4e38f71', // blue bridge
    'https://images.unsplash.com/photo-1639762681057-408e52192e55', // chain glow
  ],
  ai: [
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485', // neural network
    'https://images.unsplash.com/photo-1677442136019-21780ecad995', // AI abstract
    'https://images.unsplash.com/photo-1555255707-c07966088b7b', // AI brain
  ],
  rwa: [
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab', // skyscraper finance
    'https://images.unsplash.com/photo-1554224155-6726b3ff858f', // wall street columns
  ],
  gaming: [
    'https://images.unsplash.com/photo-1542751371-adc38448a05e', // gaming neon
  ],
  regulation: [
    'https://images.unsplash.com/photo-1555848962-6e79363ec58f', // US capitol
    'https://images.unsplash.com/photo-1589994965851-a8f479c573a9', // courthouse columns
    'https://images.unsplash.com/photo-1617391258031-f8d80b22fb35', // govt building
  ],
  regulatory: [
    'https://images.unsplash.com/photo-1589994965851-a8f479c573a9',
    'https://images.unsplash.com/photo-1555848962-6e79363ec58f',
    'https://images.unsplash.com/photo-1617391258031-f8d80b22fb35',
  ],
  macro: [
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3', // wall street
    'https://images.unsplash.com/photo-1554224154-26032ffc0d07', // economy finance
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e', // currency notes
    'https://images.unsplash.com/photo-1526628953301-3e589a6a8b74', // finance
    'https://images.unsplash.com/photo-1604594849809-dfedbc827105', // federal reserve
  ],
  stocks: [
    'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f', // stock chart screen
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3', // wall street
    'https://images.unsplash.com/photo-1559526324-4b87b5e36e44', // trading floor
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e', // market data
  ],
  crypto: [
    'https://images.unsplash.com/photo-1621416894569-0f39ed31d247',
    'https://images.unsplash.com/photo-1518546305927-5a555bb7020d',
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
  ],
  markets: [
    'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f',
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e',
  ],
  news: [
    'https://images.unsplash.com/photo-1586953208448-b95a79798f07', // news abstract
    'https://images.unsplash.com/photo-1495020689067-958852a7765e', // newspaper
  ],
  default: [
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0', // crypto abstract
    'https://images.unsplash.com/photo-1642543492481-44e81e3914a7', // fintech
    'https://images.unsplash.com/photo-1639322537228-f710d846310a', // abstract glow
  ],
};

/**
 * Deterministic picker — same slug always picks the same image from the rotation.
 * This prevents the image from changing between backfill runs.
 */
function pickFromRotation(urls, slug) {
  if (!urls || urls.length === 0) return null;
  let hash = 0;
  const s = slug || 'default';
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % urls.length;
  return urls[idx] + UNSPLASH_CDN_PARAMS;
}

/**
 * Build the prioritized cascade of candidate rotations for an article.
 * Returns an array of {pool, label} tuples — walk top-to-bottom, falling
 * through if a pool is empty or its URL 404s. Guarantees at least one valid
 * candidate because `default` is always last.
 */
function buildCuratedCascade(article) {
  const cascade = [];
  const seen = new Set();
  const push = (pool, label) => {
    if (pool && pool.length > 0) {
      const key = label + ':' + pool[0];
      if (!seen.has(key)) { seen.add(key); cascade.push({ pool, label }); }
    }
  };

  const ticker = (article.tickers || [])[0];
  if (ticker) push(UNSPLASH_CDN_BY_TICKER[ticker.toUpperCase()], `ticker:${ticker}`);

  const cat = (article.category || '').toLowerCase();
  if (cat) push(UNSPLASH_CDN_BY_CATEGORY[cat], `category:${cat}`);

  const cats = article.categories || article.tags || [];
  for (const c of cats) {
    const lc = (c || '').toLowerCase();
    push(UNSPLASH_CDN_BY_CATEGORY[lc], `tag:${lc}`);
  }

  const type = (article.type || '').toLowerCase();
  if (type === 'stocks') push(UNSPLASH_CDN_BY_CATEGORY.stocks, 'type:stocks');
  if (type === 'crypto') push(UNSPLASH_CDN_BY_CATEGORY.crypto, 'type:crypto');
  if (type === 'news') push(UNSPLASH_CDN_BY_CATEGORY.news, 'type:news');

  // ALWAYS fall through to default so we never return empty
  push(UNSPLASH_CDN_BY_CATEGORY.default, 'default');
  return cascade;
}

/**
 * Pick a single curated Unsplash CDN URL (first non-empty rotation in cascade).
 * Deterministic per slug.
 */
function pickCuratedUnsplashUrl(article) {
  const slug = article.slug || '';
  const cascade = buildCuratedCascade(article);
  for (const { pool } of cascade) {
    const url = pickFromRotation(pool, slug);
    if (url) return url;
  }
  return null;
}

/**
 * Fetch a curated Unsplash photo. Tries the cascade — if a 404 hits the first
 * candidate, it walks down to the next (category → default) so no article
 * falls through to SVG just because one URL got rotated out of Unsplash.
 */
async function fetchCuratedUnsplashImage(article) {
  const slug = article.slug || '';
  const cascade = buildCuratedCascade(article);

  for (const { pool, label } of cascade) {
    const url = pickFromRotation(pool, slug);
    if (!url) continue;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'Mozilla/5.0 Spectre/1.0' },
      });
      if (!res.ok) {
        console.warn(`[image-gen] Curated Unsplash ${res.status} at ${label} for ${slug} — trying next`);
        continue;
      }
      const arrayBuf = await res.arrayBuffer();
      if (!arrayBuf || arrayBuf.byteLength < 1024) {
        console.warn(`[image-gen] Curated Unsplash tiny buffer at ${label} for ${slug}`);
        continue;
      }
      return {
        buffer: Buffer.from(arrayBuf),
        credit: 'Unsplash',
        sourceUrl: url,
        query: label,
      };
    } catch (e) {
      console.warn(`[image-gen] Curated Unsplash fetch failed at ${label}: ${e.message}`);
    }
  }
  return null;
}

/**
 * Build an Unsplash search query from article signals.
 * Priority: first ticker → category → tags → default.
 */
function buildUnsplashQuery(article) {
  const ticker = (article.tickers || [])[0];
  if (ticker && UNSPLASH_QUERY_BY_TICKER[ticker.toUpperCase()]) {
    return UNSPLASH_QUERY_BY_TICKER[ticker.toUpperCase()];
  }
  const cat = (article.category || '').toLowerCase();
  if (cat && UNSPLASH_QUERY_BY_CATEGORY[cat]) return UNSPLASH_QUERY_BY_CATEGORY[cat];
  const cats = article.categories || article.tags || [];
  for (const c of cats) {
    const lc = (c || '').toLowerCase();
    if (UNSPLASH_QUERY_BY_CATEGORY[lc]) return UNSPLASH_QUERY_BY_CATEGORY[lc];
  }
  return UNSPLASH_QUERY_BY_CATEGORY.default;
}

/**
 * Build an AI image prompt from article data.
 */
function buildImagePrompt(article) {
  const ticker = (article.tickers || [])[0] || '';
  const tokenInfo = TOKEN_VISUALS[ticker.toUpperCase()];

  if (tokenInfo) {
    return `${tokenInfo.visual}, ${BASE_STYLE}, no text, no labels, no UI elements`;
  }

  // Try category fallback
  const cats = article.categories || article.tags || [];
  for (const cat of cats) {
    const lc = cat.toLowerCase();
    for (const [key, info] of Object.entries(CATEGORY_VISUALS)) {
      if (lc.includes(key)) {
        return `${info.visual}, ${BASE_STYLE}, no text, no labels, no UI elements`;
      }
    }
  }

  // Generic
  return `abstract ${article.type || 'cryptocurrency'} financial visualization, dark gradient, ${BASE_STYLE}, no text`;
}

/**
 * Get color info for a token/article.
 */
function getTokenColors(article) {
  const ticker = (article.tickers || [])[0] || '';
  if (TOKEN_VISUALS[ticker.toUpperCase()]) return TOKEN_VISUALS[ticker.toUpperCase()];
  const cats = article.categories || article.tags || [];
  for (const cat of cats) {
    const lc = cat.toLowerCase();
    for (const [key, info] of Object.entries(CATEGORY_VISUALS)) {
      if (lc.includes(key)) return info;
    }
  }
  return CATEGORY_VISUALS.default;
}

/**
 * Option 0 (preferred): Unsplash — FREE (50 req/hour), real editorial photography.
 * Uses /photos/random with topical query so every article gets a fresh image.
 *
 * Returns { buffer, credit, sourceUrl } or null.
 */
async function fetchUnsplashImage(article) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  const query = buildUnsplashQuery(article);
  try {
    const metaRes = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`,
      {
        headers: { Authorization: `Client-ID ${key}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!metaRes.ok) {
      console.warn(`[image-gen] Unsplash ${metaRes.status} for query="${query}"`);
      return null;
    }
    const meta = await metaRes.json();
    const photoUrl = meta?.urls?.regular || meta?.urls?.full;
    if (!photoUrl) return null;

    // Download the actual photo bytes
    const imgRes = await fetch(photoUrl, { signal: AbortSignal.timeout(12000) });
    if (!imgRes.ok) return null;
    const arrayBuf = await imgRes.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuf),
      credit: meta?.user?.name ? `${meta.user.name} / Unsplash` : 'Unsplash',
      sourceUrl: meta?.links?.html || photoUrl,
      query,
    };
  } catch (e) {
    console.warn('[image-gen] Unsplash fetch failed:', e.message);
    return null;
  }
}

/**
 * Option A: Stability AI (cheapest, ~$0.002/image)
 */
async function generateStabilityImage(prompt) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text_prompts: [
          { text: prompt, weight: 1 },
          { text: NEGATIVE_PROMPT, weight: -1 },
        ],
        cfg_scale: 7,
        height: 640,
        width: 1216,
        samples: 1,
        steps: 30,
        style_preset: 'digital-art',
      }),
    });

    if (!response.ok) {
      console.error(`[image-gen] Stability API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.artifacts && data.artifacts[0]) {
      return Buffer.from(data.artifacts[0].base64, 'base64');
    }
    return null;
  } catch (e) {
    console.error('[image-gen] Stability error:', e.message);
    return null;
  }
}

/**
 * Option B: DALL-E 3 via OpenAI ($0.04/image)
 */
async function generateDallEImage(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt,
        size: '1792x1024',
        quality: 'standard',
        n: 1,
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      console.error(`[image-gen] DALL-E API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.data && data.data[0]) {
      return Buffer.from(data.data[0].b64_json, 'base64');
    }
    return null;
  } catch (e) {
    console.error('[image-gen] DALL-E error:', e.message);
    return null;
  }
}

/**
 * Option C: SVG fallback (zero cost, always works)
 * Creates a branded Spectre-style hero image as SVG rendered to PNG.
 * Since we don't have Sharp, we save as SVG and reference it directly.
 */
function generateSvgFallback(article) {
  const { color, accent } = getTokenColors(article);
  const ticker = (article.tickers || [])[0] || '';
  const headline = (article.headline || article.title || '').slice(0, 60);
  const type = (article.type || 'research').toUpperCase();

  // Escape XML entities in text
  const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a0f;stop-opacity:1"/>
      <stop offset="50%" style="stop-color:#0d0d14;stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#0a0a12;stop-opacity:1"/>
    </linearGradient>
    <radialGradient id="orb1" cx="20%" cy="30%" r="50%">
      <stop offset="0%" style="stop-color:${color};stop-opacity:0.12"/>
      <stop offset="100%" style="stop-color:${color};stop-opacity:0"/>
    </radialGradient>
    <radialGradient id="orb2" cx="80%" cy="70%" r="40%">
      <stop offset="0%" style="stop-color:${accent};stop-opacity:0.08"/>
      <stop offset="100%" style="stop-color:${accent};stop-opacity:0"/>
    </radialGradient>
    <linearGradient id="accentLine" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${color};stop-opacity:0.6"/>
      <stop offset="50%" style="stop-color:${accent};stop-opacity:0.4"/>
      <stop offset="100%" style="stop-color:${color};stop-opacity:0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Ambient orbs -->
  <rect width="1200" height="630" fill="url(#orb1)"/>
  <rect width="1200" height="630" fill="url(#orb2)"/>

  <!-- Grid pattern -->
  <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
    <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255,255,255,0.015)" stroke-width="1"/>
  </pattern>
  <rect width="1200" height="630" fill="url(#grid)" opacity="0.5"/>

  <!-- Accent line -->
  <rect x="80" y="280" width="400" height="2" rx="1" fill="url(#accentLine)"/>

  <!-- SPECTRE INTELLIGENCE label -->
  <text x="80" y="260" font-family="Inter, -apple-system, sans-serif" font-size="11" font-weight="700" letter-spacing="3" fill="${color}" opacity="0.8">${escXml(type)} INTELLIGENCE</text>

  <!-- Ticker badge -->
  ${ticker ? `<rect x="80" y="300" width="${Math.max(ticker.length * 18 + 24, 60)}" height="36" rx="8" fill="${color}" opacity="0.12"/>
  <text x="${80 + Math.max(ticker.length * 18 + 24, 60) / 2}" y="324" font-family="Inter, -apple-system, sans-serif" font-size="16" font-weight="800" fill="${color}" text-anchor="middle" letter-spacing="2">${escXml(ticker)}</text>` : ''}

  <!-- Headline (wrapped) -->
  <text x="80" y="${ticker ? '380' : '340'}" font-family="Georgia, 'Playfair Display', serif" font-size="32" font-weight="400" fill="#f5f5f7" letter-spacing="-0.5">
    ${escXml(headline.length > 40 ? headline.slice(0, 40) : headline)}
  </text>
  ${headline.length > 40 ? `<text x="80" y="${ticker ? '420' : '380'}" font-family="Georgia, 'Playfair Display', serif" font-size="32" font-weight="400" fill="#f5f5f7" letter-spacing="-0.5">${escXml(headline.slice(40))}</text>` : ''}

  <!-- Spectre logo area (bottom-left) -->
  <text x="80" y="580" font-family="Inter, -apple-system, sans-serif" font-size="13" font-weight="600" fill="rgba(255,255,255,0.25)" letter-spacing="0.5">SPECTRE</text>
  <circle cx="140" cy="576" r="3" fill="${color}" opacity="0.6"/>

  <!-- Decorative corner element -->
  <circle cx="1100" cy="150" r="80" fill="none" stroke="${color}" stroke-width="1" opacity="0.06"/>
  <circle cx="1100" cy="150" r="50" fill="none" stroke="${accent}" stroke-width="0.5" opacity="0.04"/>
  <circle cx="1100" cy="150" r="3" fill="${color}" opacity="0.3"/>
</svg>`;

  return svg;
}

/**
 * Write `coverImage` + `imageCredit` back onto the persisted article JSON on disk
 * so listArticles/loadArticle return the image path without a /api/hero round-trip.
 */
function persistCoverImageOnDisk(article, heroPath, credit = null) {
  try {
    if (!article?.type || !article?.slug || !heroPath) return;
    const filePath = path.join(ARTICLES_DIR, article.type, `${article.slug}.json`);
    if (!fs.existsSync(filePath)) return;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    raw.coverImage = heroPath;
    if (credit) raw.imageCredit = credit;
    raw.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf-8');
    // Best-effort cache invalidation (store.js exports invalidateCache indirectly via saveArticle)
    try {
      const store = require('../content/store');
      // store.js doesn't export invalidateCache directly; trigger it via a no-op cache reset
      if (store._invalidate) store._invalidate(article.type);
    } catch (_) { /* noop */ }
  } catch (e) {
    console.warn(`[image-gen] persistCoverImage failed for ${article?.slug}:`, e.message);
  }
}

/**
 * Generate and save a hero image for an article.
 * Priority: Unsplash → Stability AI → DALL-E 3 → SVG fallback.
 * Returns the public path to the saved image (e.g. /api/og/{slug}.jpg).
 * Also persists `article.coverImage` back to the JSON file on disk.
 */
async function generateArticleImage(article) {
  if (!article || !article.slug) return null;

  const slug = article.slug;
  const pngPath = path.join(OG_DIR, `${slug}.png`);
  const jpgPath = path.join(OG_DIR, `${slug}.jpg`);
  const svgPath = path.join(OG_DIR, `${slug}.svg`);

  // Reuse existing image if present
  const existing = (fs.existsSync(jpgPath) && `/api/og/${slug}.jpg`) ||
                   (fs.existsSync(pngPath) && `/api/og/${slug}.png`) ||
                   (fs.existsSync(svgPath) && `/api/og/${slug}.svg`) || null;
  if (existing) {
    if (!article.coverImage) persistCoverImageOnDisk(article, existing);
    return existing;
  }

  console.log(`[image-gen] Generating image for: ${slug}`);

  // ── Option 0a: Curated Unsplash CDN (FIRST — no API key, always available) ──
  // Deterministic picker from a hand-curated dictionary of real editorial photos.
  const curated = await fetchCuratedUnsplashImage(article);
  if (curated?.buffer) {
    fs.writeFileSync(jpgPath, curated.buffer);
    const publicPath = `/api/og/${slug}.jpg`;
    persistCoverImageOnDisk(article, publicPath, curated.credit);
    console.log(`[image-gen] Curated Unsplash saved: ${slug}.jpg (${curated.sourceUrl.slice(0, 80)})`);
    return publicPath;
  }

  // ── Option 0b: Unsplash API (if key set — fresh random photos) ──
  const unsplash = await fetchUnsplashImage(article);
  if (unsplash?.buffer) {
    fs.writeFileSync(jpgPath, unsplash.buffer);
    const publicPath = `/api/og/${slug}.jpg`;
    persistCoverImageOnDisk(article, publicPath, unsplash.credit);
    console.log(`[image-gen] Unsplash image saved: ${slug}.jpg (${unsplash.credit}, q="${unsplash.query}")`);
    return publicPath;
  }

  const prompt = buildImagePrompt(article);

  // ── Option A: Stability AI ──
  let imageBuffer = await generateStabilityImage(prompt);
  if (imageBuffer) {
    fs.writeFileSync(pngPath, imageBuffer);
    const publicPath = `/api/og/${slug}.png`;
    persistCoverImageOnDisk(article, publicPath);
    console.log(`[image-gen] Stability AI image saved: ${slug}.png`);
    return publicPath;
  }

  // ── Option B: DALL-E 3 ──
  imageBuffer = await generateDallEImage(prompt);
  if (imageBuffer) {
    fs.writeFileSync(pngPath, imageBuffer);
    const publicPath = `/api/og/${slug}.png`;
    persistCoverImageOnDisk(article, publicPath);
    console.log(`[image-gen] DALL-E 3 image saved: ${slug}.png`);
    return publicPath;
  }

  // ── Option C: SVG fallback (always works) ──
  const svg = generateSvgFallback(article);
  fs.writeFileSync(svgPath, svg, 'utf8');
  const publicPath = `/api/og/${slug}.svg`;
  persistCoverImageOnDisk(article, publicPath);
  console.log(`[image-gen] SVG fallback saved: ${slug}.svg`);
  return publicPath;
}

/**
 * Get existing image path for a slug (if it exists).
 */
function getExistingImage(slug) {
  const jpgPath = path.join(OG_DIR, `${slug}.jpg`);
  const pngPath = path.join(OG_DIR, `${slug}.png`);
  const svgPath = path.join(OG_DIR, `${slug}.svg`);
  if (fs.existsSync(jpgPath)) return `/api/og/${slug}.jpg`;
  if (fs.existsSync(pngPath)) return `/api/og/${slug}.png`;
  if (fs.existsSync(svgPath)) return `/api/og/${slug}.svg`;
  return null;
}

/**
 * Serve OG image by slug. Used by Express route.
 */
function serveOgImage(slug) {
  const jpgPath = path.join(OG_DIR, `${slug}.jpg`);
  const pngPath = path.join(OG_DIR, `${slug}.png`);
  const svgPath = path.join(OG_DIR, `${slug}.svg`);
  if (fs.existsSync(jpgPath)) return { path: jpgPath, type: 'image/jpeg' };
  if (fs.existsSync(pngPath)) return { path: pngPath, type: 'image/png' };
  if (fs.existsSync(svgPath)) return { path: svgPath, type: 'image/svg+xml' };
  return null;
}

module.exports = {
  generateArticleImage,
  persistCoverImageOnDisk,
  fetchUnsplashImage,
  fetchCuratedUnsplashImage,
  pickCuratedUnsplashUrl,
  buildImagePrompt,
  buildUnsplashQuery,
  getExistingImage,
  serveOgImage,
  getTokenColors,
  TOKEN_VISUALS,
  CATEGORY_VISUALS,
  UNSPLASH_QUERY_BY_CATEGORY,
  UNSPLASH_QUERY_BY_TICKER,
  UNSPLASH_CDN_BY_TICKER,
  UNSPLASH_CDN_BY_CATEGORY,
  OG_DIR,
};
